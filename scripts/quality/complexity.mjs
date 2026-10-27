import ts from "typescript";

// Biome spans are UTF-8 byte offsets, TypeScript positions are UTF-16 offsets.
export function complexityEntries(diagnostics) {
	return diagnostics
		.filter((d) => d.category === "lint/complexity/noExcessiveCognitiveComplexity")
		.map((d) => {
			const { sourceCode, span, path } = d.location;
			const position = Buffer.from(sourceCode).subarray(0, span[0]).toString("utf8").length;
			const source = ts.createSourceFile(path.file, sourceCode, ts.ScriptTarget.Latest, true);
			const functions = [];
			function visit(node, parent, counts) {
				let owner = parent;
				let children = counts;
				if (ts.isFunctionLike(node) && node.body) {
					const name = functionName(node, source);
					const count = (counts.get(name) ?? 0) + 1;
					counts.set(name, count);
					owner = `${parent}/${name}${count > 1 ? `#${count}` : ""}`;
					children = new Map();
					if (node.getStart(source) <= position && position < node.end) functions.push(owner);
				}
				ts.forEachChild(node, (child) => visit(child, owner, children));
			}
			visit(source, "", new Map());
			const owner = functions.at(-1);
			const score = Number(/complexity of (\d+)/.exec(d.description)?.[1]);
			if (!owner || !Number.isFinite(score))
				throw new Error("Unrecognized Biome complexity diagnostic");
			return { key: `${path.file}:${owner}`, score };
		});
}

export function violations(entries, baseline) {
	return entries.filter(({ key, score }) => score > (baseline[key] ?? 15));
}

function functionName(node, source) {
	if (node.name) return node.name.getText(source);
	if (!ts.isCallExpression(node.parent)) return "callback";
	const expression = node.parent.expression;
	return ts.isPropertyAccessExpression(expression)
		? expression.name.text
		: expression.getText(source);
}
