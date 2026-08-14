/**
 * Narrowing a lineage to one lot's neighbourhood.
 *
 * The full diagram belongs to the order. On a lot's own page most of it is
 * someone else's business: coffee that never touched this lot, sitting in the
 * same picture as coffee that did.
 *
 * What counts as "touched this lot" is deliberately not symmetric:
 *
 *   · **where it came from** — every ancestor, however far back. A lot's own
 *     history is the whole chain behind it, and stopping partway would show a
 *     parent with no explanation of where *it* came from.
 *
 *   · **what it fed** — its direct children only. A grandchild is a different
 *     lot's story: it may be mostly other coffee by then, and following it
 *     forward is how one lot's page ends up redrawing the entire order.
 *
 *   · **who it was mixed with** — the other parents of those children. A combo
 *     is not legible with one side of it missing: "D became F" invites the
 *     question of where F's other 4 kg came from, and the answer is one node.
 *
 * So from A, which was hulled into D, and where D was later combined with C
 * into F:
 *
 *   A  ·  A → D                    (its own split; F is not A's story)
 *   D  ·  A → D → F ← C            (its parent, its child, and F's other parent)
 *   F  ·  A → D → F ← C            (both parents, and D's parent behind them)
 */

export type LineageNode = { id: number };
export type LineageEdge = { from: number; to: number };

export type Lineage<N extends LineageNode, E extends LineageEdge> = {
	nodes: N[];
	edges: E[];
};

/** The subgraph of one lot's neighbourhood, as described above. */
export function focusLineage<N extends LineageNode, E extends LineageEdge>(
	graph: Lineage<N, E>,
	lotId: number
): Lineage<N, E> {
	const keep = new Set<number>([lotId]);

	// Every ancestor, walked back to the lots the client sent.
	const pending = [lotId];
	while (pending.length > 0) {
		const id = pending.pop()!;
		for (const edge of graph.edges) {
			if (edge.to === id && !keep.has(edge.from)) {
				keep.add(edge.from);
				pending.push(edge.from);
			}
		}
	}

	// Its direct children, and whatever else went into them.
	for (const edge of graph.edges) {
		if (edge.from !== lotId) continue;
		keep.add(edge.to);
		for (const other of graph.edges) {
			if (other.to === edge.to) keep.add(other.from);
		}
	}

	return {
		nodes: graph.nodes.filter((node) => keep.has(node.id)),
		// Only edges with both ends kept: a half-drawn arrow points at nothing.
		edges: graph.edges.filter((edge) => keep.has(edge.from) && keep.has(edge.to))
	};
}
