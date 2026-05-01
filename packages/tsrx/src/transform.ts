import type { ParseResult } from "@tsrx/core/types";
import type { SourceMap } from "./writer.js";
import type * as AST from "estree";
import type {
  JSXElement,
  JSXExpressionContainer,
  JSXFragment,
  JSXSpreadChild,
  JSXText,
} from "estree-jsx";


export type CompileResult = {
  ast: ParseResult["ast"];
  code: string;
  map: SourceMap;
  writer: Writer;
};

/** Nodes that carry source positions, used for slicing and source mapping. */
type Sliceable = { start?: number; end?: number };

type TsrxElement = AST.BaseNode & {
  type: "Element";
  id: AST.Identifier | AST.MemberExpression;
  attributes: AST.TSRXAttribute[];
  children: AST.Node[];
  selfClosing?: boolean;
  css?: string;
};

type Component = AST.BaseNode & {
  type: "Component";
  id: AST.Identifier | null;
  params: AST.Pattern[];
  body: AST.Node[];
  default: boolean;
};
import { Writer } from "./writer.js";

// ─── Transformer ─────────────────────────────────────────────────────────────

export class Transformer {
  #source: string;
  #w: Writer;
  #defineNames: ReadonlySet<string> = new Set();

  constructor(
    ast: ParseResult["ast"] | null,
    source: string,
    private filename: string | undefined,
  ) {
    this.#source = source;
    this.#w = new Writer(source);
    if (ast !== null) this.#transform(ast as AST.Program);
  }

  result(): CompileResult {
    const code = this.#w.toString();
    const map = this.#w.generateMap(this.filename, this.#source);
    return { ast: undefined as never, code, map, writer: this.#w };
  }

  // ── Top-level program walk ─────────────────────────────────────────────────

  #transform(program: AST.Program): void {
    for (const node of program.body) {
      if ((node as AST.Node & { type: string }).type === "ServerBlock") {
        throw new Error(
          "`#server { ... }` blocks are not supported by @marko/tsrx.",
        );
      }
    }

    /**
     * Categorised program nodes.
     *
     * `rootComp` — the component whose body is emitted at the Marko root.
     * `defineComps` — named components emitted as `<define/Name>`.
     * `statics` — everything else (imports, top-level stmts) emitted as `static`.
     */
    type NamedComp = { name: string; comp: Component; node: AST.Node };
    const namedComps: NamedComp[] = [];
    let defaultComp: Component | undefined;
    const statics: AST.Node[] = [];

    // ── First pass: classify all top-level nodes ───────────────────────────
    for (const node of program.body as AST.Node[]) {
      switch (node.type) {
        case "Component": {
          const comp = node as unknown as Component;
          if (!comp.id?.name)
            throw new Error(
              "Anonymous components are not supported by @marko/tsrx.",
            );
          for (const p of comp.params) this.#throwIfLazyPattern(p);
          namedComps.push({ name: comp.id.name, comp, node });
          break;
        }

        case "ExportDefaultDeclaration": {
          const decl = (node as AST.ExportDefaultDeclaration).declaration;
          if ((decl as AST.Node).type !== "Component") {
            throw new Error(
              "`export default` must be a component declaration in @marko/tsrx.",
            );
          }
          const comp = decl as unknown as Component;
          for (const p of comp.params) this.#throwIfLazyPattern(p);
          defaultComp = comp;
          break;
        }

        case "ExportNamedDeclaration": {
          const decl = (node as AST.ExportNamedDeclaration).declaration as
            | AST.Node
            | null
            | undefined;
          if (decl?.type === "Component") {
            const comp = decl as unknown as Component;
            if (!comp.id?.name)
              throw new Error(
                "Anonymous components are not supported by @marko/tsrx.",
              );
            for (const p of comp.params) this.#throwIfLazyPattern(p);
            namedComps.push({ name: comp.id.name, comp, node, exported: true } as NamedComp & { exported: boolean });
          } else {
            statics.push(node);
          }
          break;
        }

        default:
          statics.push(node);
          break;
      }
    }

    // ── Second pass: pick which component lives at the Marko root ──────────
    //
    // Rules (evaluated in priority order):
    //   1. `export default component` → always wins.
    //   2. Only one component total → it lives at root.
    //   3. Exactly one *exported* named component → it wins.
    //   4. Everything else → all components become `<define>`.
    //
    // In cases 2 & 3 the "winner" is removed from namedComps so it won't also
    // be emitted as a <define>.

    let rootComp: Component | undefined;

    if (defaultComp) {
      // Rule 1: explicit export default.
      rootComp = defaultComp;
    } else if (namedComps.length === 1) {
      // Rule 2: exactly one component in the whole file.
      rootComp = namedComps[0]!.comp;
      namedComps.splice(0, 1);
    } else {
      // Rule 3: exactly one exported named component.
      const exportedComps = namedComps.filter(
        (c) => (c as NamedComp & { exported?: boolean }).exported,
      );
      if (exportedComps.length === 1) {
        rootComp = exportedComps[0]!.comp;
        const idx = namedComps.indexOf(exportedComps[0]!);
        namedComps.splice(idx, 1);
      }
      // Rule 4: rootComp stays undefined → synthesise an empty component below.
    }

    if (!rootComp) {
      // No winner — synthesise an empty Marko root.
      rootComp = {
        type: "Component",
        id: null,
        params: [],
        body: [],
        default: true,
      } as unknown as Component;
    }

    // ── Emit statics ────────────────────────────────────────────────────────
    for (const node of statics) {
      this.#w.write("static ");
      this.#w.writeSrc(node as Sliceable);
      this.#w.nl();
    }

    // ── Emit <define> blocks ─────────────────────────────────────────────────
    for (const { name, comp, node } of namedComps) {
      const paramStr = this.#defineParamStr(comp.params);
      this.#w.write(paramStr ? `<define/${name}|${paramStr}|>` : `<define/${name}>`);
      this.#compileComponent(comp, /* skipInputParam */ true, /* childContext */ true);
      this.#w.write("</define>\n");
    }

    if (statics.length > 0 || namedComps.length > 0) this.#w.nl();
    this.#compileComponent(rootComp);
  }

  // ── Component ──────────────────────────────────────────────────────────────

  #compileComponent(
    comp: Component,
    skipInputParam = false,
    childContext = false,
  ): void {
    // Pre-pass: collect defineNames before any emit so the field is stable.
    this.#defineNames = this.#collectDefineNames(comp.body);
    if (!skipInputParam) this.#emitInputParam(comp.params);
    // <define> bodies are child content in Marko, so use #children (no `-- `).
    // The root component is statement context, so use #stmts.
    if (childContext) {
      this.#children(comp.body);
    } else {
      this.#stmts(comp.body);
    }
  }

  /**
   * Build the raw param string for a named `<define>` component, e.g.
   * `component Foo(bar: Baz)` → `"bar: Baz"`.  Returns an empty string
   * when there are no params.
   */
  #defineParamStr(params: AST.Pattern[]): string {
    if (!params.length) return "";
    const parts: string[] = [];
    for (const p of params) {
      const start = (p as Sliceable).start;
      const end = (p as Sliceable).end;
      if (start == null || end == null) continue;
      parts.push(this.#source.slice(start, end));
    }
    return parts.join(", ");
  }

  #collectDefineNames(body: AST.Node[]): Set<string> {
    const names = new Set<string>();
    for (const node of body) {
      if (node.type !== "VariableDeclaration") continue;
      const vd = node as AST.VariableDeclaration;
      if (vd.kind !== "const") continue;
      for (const d of vd.declarations) {
        if (
          d.id.type === "Identifier" &&
          d.init != null &&
          (d.init as AST.Node).type === "Tsx"
        ) {
          names.add((d.id as AST.Identifier).name);
        }
      }
    }
    return names;
  }

  /**
   * Emit the component's input parameter as:
   *   1. `export type Input = …;\n\n`  (if a type annotation is present)
   *   2. `<const/PATTERN=input/>\n`    (unless the param is literally named `input`)
   */
  #emitInputParam(params: AST.Pattern[]): void {
    const firstParam = params[0];
    if (!firstParam) return;

    const outerAnno = (
      firstParam as { typeAnnotation?: Sliceable & { typeAnnotation?: Sliceable } }
    ).typeAnnotation;
    const innerTypeNode = outerAnno?.typeAnnotation;

    const patternEnd = outerAnno?.start ?? (firstParam as Sliceable).end;
    const patternSlice = this.#source
      .slice((firstParam as Sliceable).start, patternEnd)
      .trimEnd();

    if (innerTypeNode?.start != null && innerTypeNode.end != null) {
      this.#w.write("export type Input = ");
      this.#w.writeSrc(innerTypeNode);
      this.#w.write(";\n\n");
    }

    if (patternSlice !== "input") {
      this.#w.write("<const/");
      this.#w.writeNode(patternSlice, (firstParam as Sliceable).start ?? 0);
      this.#w.write("=input/>\n");
    }
  }

  // ── Statement emit ─────────────────────────────────────────────────────────
  //
  // #stmt()  — statement position: expressions use Marko's `-- expr` syntax
  // #child() — child position (inside an element): expressions use `${expr}`
  //
  // Both dispatch the same node types; only the expression wrapper differs.

  #stmts(nodes: AST.Node[]): void {
    for (const n of nodes) {
      this.#stmt(n);
      if (!this.#w.atLineStart) this.#w.nl();
    }
  }

  /**
   * Emit a safe string literal in statement context.
   * Single-line: `-- text\n`
   * Multi-line:  `---\ntext\n---\n`  (Marko fence syntax)
   */
  #stmtText(text: string, srcStart: number, srcEnd: number): void {
    if (text.includes("\n")) {
      this.#w.write("---\n");
      this.#w.writeLiteralSegments(text, srcStart, srcEnd);
      this.#w.write("\n---\n");
    } else {
      this.#w.write("-- ");
      this.#w.writeLiteralSegments(text, srcStart, srcEnd);
      this.#w.write("\n");
    }
  }

  #stmt(node: AST.Node): void {
    switch (node.type) {
      case "Element":
        this.#element(node as unknown as TsrxElement);
        return;

      case "TSRXExpression": {
        const n = node as AST.TSRXExpression;
        if (
          n.expression.type === "Identifier" &&
          this.#defineNames.has((n.expression as AST.Identifier).name)
        ) {
          const id = n.expression as AST.Identifier;
          this.#w.write("<${");
          this.#w.writeNode(id.name, (id as Sliceable).start ?? 0);
          this.#w.write("}/>");
          return;
        }
        if (n.expression.type === "Literal") {
          const safe = this.#safeLiteralText((n.expression as AST.Literal).value);
          if (safe !== null) {
            this.#stmtText(safe, ...this.#literalContentRange(n.expression as Sliceable));
            return;
          }
        }
        this.#w.write("-- ${");
        this.#w.writeSrc(n.expression as Sliceable);
        this.#w.write("}\n");
        return;
      }

      case "Text": {
        const n = node as AST.BaseNode & { expression: AST.Expression };
        const expr = n.expression;
        if (expr.type === "Literal") {
          const safe = this.#safeLiteralText((expr as AST.Literal).value);
          if (safe !== null) {
            this.#stmtText(safe, ...this.#literalContentRange(expr as Sliceable));
            return;
          }
        }
        this.#w.write("-- ${");
        this.#w.writeSrc(expr as Sliceable);
        this.#w.write("}\n");
        return;
      }

      case "Html": {
        const n = node as AST.Html;
        this.#w.write("-- $!{");
        this.#w.writeSrc(n.expression as Sliceable);
        this.#w.write("}\n");
        return;
      }

      case "VariableDeclaration":
        this.#variableDeclaration(node as AST.VariableDeclaration);
        return;

      case "IfStatement":
        this.#emitIf(node as AST.IfStatement);
        return;

      case "ForOfStatement":
        this.#emitForOf(node as AST.ForOfStatement);
        return;

      case "SwitchStatement":
        this.#emitSwitch(node as AST.SwitchStatement);
        return;

      case "TryStatement":
        this.#emitTry(node as AST.TryStatement);
        return;

      case "BlockStatement":
        this.#stmts((node as AST.BlockStatement).body);
        return;

      case "ExpressionStatement": {
        const ex = (node as AST.ExpressionStatement).expression;
        if (ex.type === "Literal") return;
        if (
          ex.type === "Identifier" &&
          this.#defineNames.has((ex as AST.Identifier).name)
        ) {
          this.#w.write("<${");
          this.#w.writeSrc(ex as Sliceable);
          this.#w.write("}/>");
          return;
        }
        this.#w.write("${");
        this.#w.writeSrc(ex as Sliceable);
        this.#w.write("}");
        return;
      }

      case "EmptyStatement":
        return;

      default:
        return;
    }
  }

  #children(nodes: AST.Node[]): void {
    // Probe each child first so we can insert "\n" only between two adjacent
    // Element nodes (without needing to go back in the Writer).
    const pending: Array<{ node: AST.Node; emit: () => void }> = [];
    for (const n of nodes) {
      const probe = this.#probe((t) => t.#child(n));
      if (!probe) continue;
      pending.push({ node: n, emit: () => this.#child(n) });
    }
    for (let i = 0; i < pending.length; i++) {
      const p = pending[i]!;
      const prev = pending[i - 1];
      if (prev && p.node.type === "Element" && prev.node.type === "Element") {
        this.#w.nl();
      }
      p.emit();
    }
  }

  #child(node: AST.Node): void {
    switch (node.type) {
      case "Text": {
        const n = node as AST.BaseNode & { expression: AST.Expression };
        const expr = n.expression;
        if (expr.type === "Literal") {
          const safe = this.#safeLiteralText((expr as AST.Literal).value);
          if (safe !== null) {
            this.#w.writeLiteralSegments(safe, ...this.#literalContentRange(expr as Sliceable));
            return;
          }
        }
        this.#w.write("${");
        this.#w.writeSrc(expr as Sliceable);
        this.#w.write("}");
        return;
      }

      case "Html": {
        const n = node as AST.Html;
        this.#w.write("$!{");
        this.#w.writeSrc(n.expression as Sliceable);
        this.#w.write("}");
        return;
      }

      case "TSRXExpression": {
        const n = node as AST.TSRXExpression;
        if (
          n.expression.type === "Identifier" &&
          this.#defineNames.has((n.expression as AST.Identifier).name)
        ) {
          const id = n.expression as AST.Identifier;
          this.#w.write("<${");
          this.#w.writeNode(id.name, (id as Sliceable).start ?? 0);
          this.#w.write("}/>");
          return;
        }
        if (n.expression.type === "Literal") {
          const safe = this.#safeLiteralText((n.expression as AST.Literal).value);
          if (safe !== null) {
            this.#w.writeLiteralSegments(safe, ...this.#literalContentRange(n.expression as Sliceable));
            return;
          }
        }
        this.#w.write("${");
        this.#w.writeSrc(n.expression as Sliceable);
        this.#w.write("}");
        return;
      }

      case "Element":
        this.#element(node as unknown as TsrxElement);
        return;

      case "ExpressionStatement": {
        const ex = (node as AST.ExpressionStatement).expression;
        if (ex.type === "Literal") {
          const safe = this.#safeLiteralText((ex as AST.Literal).value);
          if (safe !== null) {
            this.#w.writeLiteralSegments(safe, ...this.#literalContentRange(ex as Sliceable));
            return;
          }
        }
        this.#w.write("${");
        this.#w.writeSrc(ex as Sliceable);
        this.#w.write("}");
        return;
      }

      default:
        this.#stmt(node);
        return;
    }
  }

  // ── Element ────────────────────────────────────────────────────────────────

  #element(el: TsrxElement): void {
    const tagRaw = this.#slice(el.id as Sliceable);

    if (tagRaw === "style") {
      this.#w.write(`<style>${typeof el.css === "string" ? el.css : ""}</style>`);
      return;
    }

    if (tagRaw === "script") {
      const scriptChild = el.children[0] as (Sliceable & { type: string }) | undefined;
      this.#w.write("<script>");
      if (scriptChild) this.#w.writeSrc(scriptChild);
      this.#w.write("</script>");
      return;
    }

    const isDynamic =
      el.id.type === "MemberExpression" ||
      (el.id.type === "Identifier" &&
        this.#defineNames.has((el.id as AST.Identifier).name));

    const refAttr = el.attributes.find((a) => a.type === "RefAttribute") as
      | (AST.BaseNode & { type: "RefAttribute"; argument: AST.Expression })
      | undefined;
    const refName =
      refAttr?.argument.type === "Identifier"
        ? (refAttr.argument as AST.Identifier).name
        : undefined;

    if (isDynamic) {
      this.#w.write("<${");
      this.#w.writeSrc(el.id as Sliceable);
      this.#w.write("}");
    } else if (refName) {
      this.#w.write("<");
      this.#w.writeSrc(el.id as Sliceable);
      this.#w.write(`/${refName}`);
    } else {
      this.#w.write("<");
      this.#w.writeSrc(el.id as Sliceable);
    }

    for (const attr of el.attributes) {
      if (attr.type === "RefAttribute") continue;
      if (attr.type === "SpreadAttribute") {
        this.#w.write(" ...");
        this.#w.writeSrc((attr as AST.SpreadAttribute).argument as Sliceable);
      } else if (attr.type === "Attribute") {
        const a = attr as AST.Attribute;
        const n = a.name.name;
        if (a.shorthand && a.value?.type === "Identifier") {
          const val = a.value as AST.Identifier;
          this.#w.write(` ${n}=`);
          this.#w.writeNode(val.name, (val as Sliceable).start ?? 0);
        } else {
          this.#w.write(` ${n}=`);
          const raw = this.#attrValue(a.value);
          this.#w.writeNode(raw, (a.value as Sliceable | null)?.start ?? 0);
        }
      }
    }

    if (el.selfClosing) {
      this.#w.write("/>");
      return;
    }
    this.#w.write(">");
    this.#children(el.children as AST.Node[]);
    if (isDynamic) {
      this.#w.write("</${");
      this.#w.writeSrc(el.id as Sliceable);
      this.#w.write("}>");
    } else {
      this.#w.write(`</${tagRaw}>`);
    }
  }

  // ── Variable declarations ──────────────────────────────────────────────────

  #variableDeclaration(vd: AST.VariableDeclaration): void {
    for (const d of vd.declarations) {
      const pat = d.id as Sliceable & { typeAnnotation?: { start?: number } };
      const patEnd = pat.typeAnnotation?.start ?? pat.end;
      const patSlice = this.#source.slice(pat.start, patEnd).trimEnd();

      if (d.init && (d.init as AST.Node).type === "Tsx") {
        if (d.id.type === "Identifier") {
          const name = (d.id as AST.Identifier).name;
          const tsx = d.init as unknown as AST.Tsx;
          this.#w.write(`<define/${name}>`);
          for (const c of tsx.children) this.#jsxChild(c);
          this.#w.write("</define>");
        }
      } else if (vd.kind === "const" && d.init != null) {
        this.#w.write("<const/");
        this.#w.writeNode(patSlice, pat.start ?? 0);
        this.#w.write("=");
        this.#w.writeSrc(d.init as Sliceable);
        this.#w.write("/>");
      } else {
        this.#w.write("<let/");
        this.#w.writeNode(patSlice, pat.start ?? 0);
        if (d.init) {
          this.#w.write("=");
          this.#w.writeSrc(d.init as Sliceable);
        }
        this.#w.write("/>");
      }
    }
  }

  // ── Control flow ───────────────────────────────────────────────────────────

  #emitIf(node: AST.IfStatement): void {
    this.#w.write("<if=");
    this.#w.writeNode(this.#attrValue(node.test as unknown as AST.Expression), (node.test as Sliceable).start ?? 0);
    this.#w.write(">");
    this.#block(node.consequent);
    this.#w.write("</if>");

    let alt: AST.Statement | null | undefined = node.alternate;
    while (alt?.type === "IfStatement") {
      const i = alt as AST.IfStatement;
      this.#w.write("<else if=");
      this.#w.writeNode(this.#attrValue(i.test as unknown as AST.Expression), (i.test as Sliceable).start ?? 0);
      this.#w.write(">");
      this.#block(i.consequent);
      this.#w.write("</else>");
      alt = i.alternate ?? null;
    }

    if (alt?.type === "BlockStatement") {
      if (this.#probe((t) => t.#blockStmts((alt as AST.BlockStatement).body))) {
        this.#w.write("<else>");
        this.#blockStmts((alt as AST.BlockStatement).body);
        this.#w.write("</else>");
      }
    }
  }

  #emitForOf(node: AST.ForOfStatement): void {
    const left = node.left as AST.VariableDeclaration;
    const d = left.declarations[0];
    const bind = d?.id.type === "Identifier" ? (d.id as AST.Identifier).name : undefined;
    const idx =
      node.index?.type === "Identifier" ? (node.index as AST.Identifier).name : null;
    const keyExpr = node.key ?? null;

    if (bind && idx) {
      this.#w.write(`<for|${bind}, ${idx}| of=`);
    } else if (bind) {
      this.#w.write(`<for|${bind}| of=`);
    } else {
      this.#w.write("<for of=");
    }
    this.#w.writeNode(this.#attrValue(node.right as unknown as AST.Expression), (node.right as Sliceable).start ?? 0);

    if (bind && keyExpr) {
      this.#w.write(` by=(${bind}) => `);
      this.#w.writeSrc(keyExpr as Sliceable);
    }
    this.#w.write(">");
    this.#block(node.body);
    this.#w.write("</for>");
  }

  #emitSwitch(node: AST.SwitchStatement): void {
    const disc = this.#slice(node.discriminant as Sliceable);
    let first = true;

    for (const c of node.cases) {
      const body = c.consequent.filter(
        (s) => s.type !== "BreakStatement" && s.type !== "EmptyStatement",
      );

      if (c.test == null) {
        if (this.#probe((t) => t.#blockStmts(body))) {
          this.#w.write("<else>");
          this.#blockStmts(body);
          this.#w.write("</else>");
        }
        continue;
      }

      const cond = `${disc}===${this.#slice(c.test as Sliceable)}`;
      if (first) {
        this.#w.write("<if=");
        this.#w.writeNode(cond, (node.discriminant as Sliceable).start ?? 0);
        this.#w.write(">");
        this.#blockStmts(body);
        this.#w.write("</if>");
        first = false;
      } else {
        this.#w.write("<else if=");
        this.#w.writeNode(cond, (node.discriminant as Sliceable).start ?? 0);
        this.#w.write(">");
        this.#blockStmts(body);
        this.#w.write("</else>");
      }
    }
  }

  #emitTry(node: AST.TryStatement): void {
    this.#w.write("<try>");
    this.#blockStmts(node.block.body);

    const pending = (node as AST.TryStatement & { pending?: AST.BlockStatement }).pending;
    if (pending?.body?.length) {
      this.#w.write("<@placeholder>");
      this.#blockStmts(pending.body);
      this.#w.write("</@placeholder>");
    }

    if (node.handler?.param?.type === "Identifier") {
      const err = (node.handler.param as AST.Identifier).name;
      this.#w.write(`<@catch|${err}|>`);
      this.#blockStmts(node.handler.body.body);
      this.#w.write("</@catch>");
    }

    this.#w.write("</try>");
  }

  /** Emit a block statement's body, or a single non-block statement.
   * Uses #child for expression-like nodes since control-flow bodies are
   * child context in Marko (no `-- ` prefix). */
  #block(node: AST.Statement): void {
    if (node.type === "BlockStatement") {
      this.#blockStmts((node as AST.BlockStatement).body);
    } else {
      this.#child(node as AST.Node);
    }
  }

  #blockStmts(nodes: AST.Node[]): void {
    for (const n of nodes) this.#child(n);
  }

  // ── JSX (inside <tsx> blocks) ──────────────────────────────────────────────

  #jsxElement(el: JSXElement): void {
    const opening = el.openingElement;
    const tag = opening.name.type === "JSXIdentifier" ? opening.name.name : "div";

    this.#w.write(`<${tag}`);
    for (const attr of opening.attributes) {
      if (attr.type === "JSXSpreadAttribute") {
        this.#w.write(" ...");
        this.#w.writeSrc(attr.argument as Sliceable);
      } else if (attr.type === "JSXAttribute") {
        const attrName = attr.name.type === "JSXIdentifier" ? attr.name.name : "data";
        if (attr.value == null) {
          this.#w.write(` ${attrName}`);
        } else if (attr.value.type === "JSXExpressionContainer") {
          this.#w.write(` ${attrName}=`);
          const exprNode = attr.value.expression as AST.Expression;
          const raw = this.#slice(exprNode as Sliceable);
          this.#w.writeNode(
            this.#needsAttrParens(raw) ? `(${raw})` : raw,
            (exprNode as Sliceable).start ?? 0,
          );
        } else if (attr.value.type === "Literal") {
          const lit = attr.value as AST.Literal;
          this.#w.write(` ${attrName}=`);
          this.#w.writeNode(JSON.stringify(lit.value), (lit as Sliceable).start ?? 0);
        }
      }
    }

    if (opening.selfClosing) {
      this.#w.write("/>");
      return;
    }
    this.#w.write(">");
    for (const c of el.children) this.#jsxChild(c);
    this.#w.write(`</${tag}>`);
  }

  #jsxChild(
    child: JSXElement | JSXText | JSXExpressionContainer | JSXFragment | JSXSpreadChild,
  ): void {
    switch (child.type) {
      case "JSXText": {
        const v = child.value.replace(/\s+/g, " ");
        if (v.trim() !== "") this.#w.write(v);
        return;
      }
      case "JSXExpressionContainer": {
        const expr = child.expression;
        if (expr.type === "JSXEmptyExpression") return;
        if (expr.type === "Literal") {
          const safe = this.#safeLiteralText((expr as AST.Literal).value);
          if (safe !== null) {
            this.#w.writeLiteralSegments(safe, ...this.#literalContentRange(expr as Sliceable));
            return;
          }
        }
        this.#w.write("${");
        this.#w.writeSrc(expr as Sliceable);
        this.#w.write("}");
        return;
      }
      case "JSXElement":
        this.#jsxElement(child);
        return;
      default:
        return;
    }
  }

  // ── Probing ────────────────────────────────────────────────────────────────
  //
  // Some emit paths need to know whether a block produces output *before*
  // committing wrapper tags. #probe() runs a callback against a throwaway
  // Transformer that shares #source and #defineNames but has its own Writer,
  // then returns the output (empty string = no output).

  #probe(fn: (t: Transformer) => void): string {
    const scratch = new Transformer(null, this.#source, this.filename);
    scratch.#defineNames = this.#defineNames;
    fn(scratch);
    return scratch.#w.toString();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  #slice(node: Sliceable): string {
    if (node.start == null || node.end == null) return "";
    return this.#source.slice(node.start, node.end);
  }

  #attrValue(expr: AST.Expression | null): string {
    if (expr == null) return "true";
    const raw = this.#slice(expr as Sliceable);
    return this.#needsAttrParens(raw) ? `(${raw})` : raw;
  }

  #needsAttrParens(src: string): boolean {
    let depth = 0;
    let quote: string | null = null;
    for (let i = 0; i < src.length; i++) {
      const c = src[i]!;
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"' || c === "`") { quote = c; continue; }
      if (c === "(") depth++;
      else if (c === ")" && depth > 0) depth--;
      else if (depth === 0 && (c === "<" || c === ">")) return true;
    }
    return false;
  }

  /** Returns [srcStart, srcEnd] for the content of a quoted string literal node,
   *  i.e. the source offsets of the characters between the surrounding quotes. */
  #literalContentRange(node: Sliceable): [number, number] {
    return [(node.start ?? 0) + 1, (node.end ?? 0) - 1];
  }

  #safeLiteralText(value: unknown): string | null {
    if (typeof value !== "string") return null;
    if (/[<>${}]/.test(value)) return null;
    return value;
  }

  #throwIfLazyPattern(pattern: AST.Pattern | null): void {
    if (pattern == null) return;
    switch (pattern.type) {
      case "ObjectPattern":
        if ((pattern as AST.ObjectPattern & { lazy?: boolean }).lazy) {
          throw new Error(
            "Lazy destructuring (&{...}) is not yet supported by @marko/tsrx.",
          );
        }
        for (const p of (pattern as AST.ObjectPattern).properties) {
          if (p.type === "Property") this.#throwIfLazyPattern(p.value as AST.Pattern);
          if (p.type === "RestElement") this.#throwIfLazyPattern(p.argument);
        }
        break;
      case "ArrayPattern":
        if ((pattern as AST.ArrayPattern & { lazy?: boolean }).lazy) {
          throw new Error(
            "Lazy destructuring (&[...]) is not yet supported by @marko/tsrx.",
          );
        }
        for (const el of (pattern as AST.ArrayPattern).elements) {
          if (el) this.#throwIfLazyPattern(el as AST.Pattern);
        }
        break;
      case "AssignmentPattern":
        this.#throwIfLazyPattern((pattern as AST.AssignmentPattern).left);
        break;
      case "RestElement":
        this.#throwIfLazyPattern((pattern as AST.RestElement).argument);
        break;
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function transform(
  ast: ParseResult["ast"],
  source: string,
  filename?: string,
): CompileResult {
  const result = new Transformer(ast, source, filename).result();
  return { ast, code: result.code, map: result.map, writer: result.writer };
}
