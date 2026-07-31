import { PostgreSQL } from "@codemirror/lang-sql";

type SyntaxNode = ReturnType<
  typeof PostgreSQL.language.parser.parse
>["topNode"];

export type SqlRiskType =
  | "drop"
  | "truncate"
  | "unconditional-delete"
  | "unconditional-update";

export type SqlRiskSeverity = "critical" | "high";
export type SqlRiskCategory = "schema-change" | "data-loss";

export interface SqlRisk {
  type: SqlRiskType;
  severity: SqlRiskSeverity;
  category: SqlRiskCategory;
  from: number;
  to: number;
  operationFrom: number;
  operationTo: number;
  statementSummary: string;
  objectType?: string;
  targets: string[];
}

interface DirectToken {
  node: SyntaxNode;
  text: string;
}

interface CommandToken extends DirectToken {
  childIndex: number;
}

const commands = new Set([
  "ALTER",
  "CREATE",
  "DELETE",
  "DROP",
  "INSERT",
  "MERGE",
  "SELECT",
  "TRUNCATE",
  "UPDATE",
  "VALUES",
]);

const targetNodeNames = new Set([
  "CompositeIdentifier",
  "Identifier",
  "QuotedIdentifier",
]);

function directChildren(node: SyntaxNode): SyntaxNode[] {
  const children: SyntaxNode[] = [];

  for (let child = node.firstChild; child; child = child.nextSibling) {
    children.push(child);
  }

  return children;
}

function tokenText(sql: string, node: SyntaxNode): string {
  return sql.slice(node.from, node.to);
}

function keywordTokens(sql: string, children: SyntaxNode[]): CommandToken[] {
  const keywords: CommandToken[] = [];

  children.forEach((node, childIndex) => {
    if (node.name === "Keyword") {
      keywords.push({
        node,
        childIndex,
        text: tokenText(sql, node).toUpperCase(),
      });
    }
  });

  return keywords;
}

function containsKeyword(
  sql: string,
  node: SyntaxNode,
  expected: string,
): boolean {
  if (
    node.name === "Keyword" &&
    tokenText(sql, node).toUpperCase() === expected
  ) {
    return true;
  }

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (containsKeyword(sql, child, expected)) return true;
  }

  return false;
}

function resolveCommand(
  sql: string,
  children: SyntaxNode[],
  keywords: CommandToken[],
): CommandToken | null {
  const first = keywords[0];
  if (!first) return null;

  if (first.text === "WITH") {
    return (
      keywords.find(
        (keyword) =>
          keyword.childIndex > first.childIndex && commands.has(keyword.text),
      ) ?? null
    );
  }

  // EXPLAIN ANALYZE executes the wrapped statement. Plain EXPLAIN does not.
  if (first.text === "EXPLAIN") {
    const wrapped = keywords.find(
      (keyword) =>
        keyword.childIndex > first.childIndex && commands.has(keyword.text),
    );
    if (!wrapped) return null;

    const analyzeDirectly = keywords.some(
      (keyword) =>
        keyword.text === "ANALYZE" && keyword.childIndex < wrapped.childIndex,
    );
    const analyzeInOptions = children
      .slice(first.childIndex + 1, wrapped.childIndex)
      .some((child) => containsKeyword(sql, child, "ANALYZE"));
    return analyzeDirectly || analyzeInOptions ? wrapped : null;
  }

  return commands.has(first.text) ? first : null;
}

function summarizeStatement(sql: string, statement: SyntaxNode): string {
  const normalized = tokenText(sql, statement).trim().replace(/\s+/g, " ");
  return normalized.length <= 180
    ? normalized
    : `${normalized.slice(0, 177)}...`;
}

function operationEnd(children: SyntaxNode[], container: SyntaxNode): number {
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];
    if (child && child.name !== ")" && child.name !== ";") return child.to;
  }

  return container.to;
}

function firstTargetAfter(
  sql: string,
  children: SyntaxNode[],
  childIndex: number,
): string[] {
  for (let index = childIndex + 1; index < children.length; index += 1) {
    const child = children[index];
    if (child && targetNodeNames.has(child.name)) {
      return [tokenText(sql, child)];
    }
  }

  return [];
}

function targetsAfter(
  sql: string,
  children: SyntaxNode[],
  childIndex: number,
  stopKeywords: ReadonlySet<string>,
): string[] {
  const targets: string[] = [];

  for (let index = childIndex + 1; index < children.length; index += 1) {
    const child = children[index];
    if (!child) continue;

    if (
      child.name === "Keyword" &&
      stopKeywords.has(tokenText(sql, child).toUpperCase())
    ) {
      break;
    }

    if (targetNodeNames.has(child.name)) {
      targets.push(tokenText(sql, child));
    }
  }

  return targets;
}

function createRisk(
  sql: string,
  statement: SyntaxNode,
  container: SyntaxNode,
  children: SyntaxNode[],
  command: CommandToken,
): SqlRisk | null {
  const base = {
    from: statement.from,
    to: statement.to,
    operationFrom: command.node.from,
    operationTo: operationEnd(children, container),
    statementSummary: summarizeStatement(sql, statement),
  };

  if (command.text === "DROP") {
    const objectTypeToken = children
      .slice(command.childIndex + 1)
      .find((child) => child.name === "Keyword");
    const objectType = objectTypeToken
      ? tokenText(sql, objectTypeToken).toUpperCase()
      : undefined;
    const targetStart = objectTypeToken
      ? children.indexOf(objectTypeToken)
      : command.childIndex;

    return {
      ...base,
      type: "drop",
      severity: "critical",
      category: "schema-change",
      ...(objectType ? { objectType } : {}),
      targets: targetsAfter(
        sql,
        children,
        targetStart,
        new Set(["CASCADE", "RESTRICT"]),
      ),
    };
  }

  if (command.text === "TRUNCATE") {
    return {
      ...base,
      type: "truncate",
      severity: "critical",
      category: "data-loss",
      objectType: "TABLE",
      targets: targetsAfter(
        sql,
        children,
        command.childIndex,
        new Set(["CONTINUE", "IDENTITY", "RESTART", "CASCADE", "RESTRICT"]),
      ),
    };
  }

  if (command.text !== "DELETE" && command.text !== "UPDATE") return null;

  const hasWhere = children.some(
    (child, childIndex) =>
      childIndex > command.childIndex &&
      child.name === "Keyword" &&
      tokenText(sql, child).toUpperCase() === "WHERE",
  );
  if (hasWhere) return null;

  const targetAnchor =
    command.text === "DELETE"
      ? children.findIndex(
          (child, childIndex) =>
            childIndex > command.childIndex &&
            child.name === "Keyword" &&
            tokenText(sql, child).toUpperCase() === "FROM",
        )
      : command.childIndex;

  return {
    ...base,
    type:
      command.text === "DELETE"
        ? "unconditional-delete"
        : "unconditional-update",
    severity: "high",
    category: "data-loss",
    objectType: "TABLE",
    targets: firstTargetAfter(
      sql,
      children,
      targetAnchor >= 0 ? targetAnchor : command.childIndex,
    ),
  };
}

function analyzeContainer(
  sql: string,
  statement: SyntaxNode,
  container: SyntaxNode,
): SqlRisk | null {
  const children = directChildren(container);
  const command = resolveCommand(sql, children, keywordTokens(sql, children));
  return command
    ? createRisk(sql, statement, container, children, command)
    : null;
}

function visitStatement(
  sql: string,
  statement: SyntaxNode,
  node: SyntaxNode,
  risks: SqlRisk[],
): void {
  if (node.name === "Statement" || node.name === "Parens") {
    const risk = analyzeContainer(sql, statement, node);
    if (risk) risks.push(risk);
  }

  for (let child = node.firstChild; child; child = child.nextSibling) {
    visitStatement(sql, statement, child, risks);
  }
}

export function analyzeSqlRisks(sql: string): SqlRisk[] {
  const tree = PostgreSQL.language.parser.parse(sql);
  const risks: SqlRisk[] = [];

  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (node.name === "Statement") {
      visitStatement(sql, node, node, risks);
    }
  }

  return risks.sort((left, right) => left.operationFrom - right.operationFrom);
}
