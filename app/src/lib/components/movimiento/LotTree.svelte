<script lang="ts">
	/**
	 * The order's lineage, laid out as a directed graph and drawn left to right.
	 *
	 * Per-order rather than per-lot, because the shapes worth seeing span two
	 * hops. A lot split into D and then recombined with it —
	 *
	 *        ┌────▶ D ────┐
	 *   A ───┤            ├───▶ E
	 *        └────────────┘
	 *
	 * — is a diamond, and no neighbourhood of a single lot can show it: from E
	 * you would see A and D as parents with no way to know D came from A.
	 *
	 * `d3-dag` only computes coordinates; every box below is our own SVG, so the
	 * lots keep the app's palette, stay real links to their pages, and scale to a
	 * wall monitor without blurring.
	 *
	 * The layout runs top-to-bottom and is transposed when drawn, which is why
	 * node sizes are given height-first.
	 */
	import {
		coordSimplex,
		decrossOpt,
		decrossTwoLayer,
		graphConnect,
		layeringSimplex,
		sugiyama
	} from 'd3-dag';
	import Icon from '$lib/components/Icon.svelte';
	import { lotMark } from '$lib/lotIcons';
	import { formatKilos } from '$lib/domain/derived';
	import type { LineageGraph } from '$lib/server/movimientos';

	let {
		graph,
		/** Drawn in the accent colour; the lot whose page this is. */
		currentLotId
	}: {
		graph: LineageGraph;
		currentLotId?: number;
	} = $props();

	const BOX = { height: 46 };

	/**
	 * How wide a box has to be for its own label.
	 *
	 * A fixed width fits "A - Castillo" and not "D - Castillo MALLA 14", and the
	 * name is the one thing on the node that has to be readable — so the box
	 * follows the text rather than the other way round. The factor is the average
	 * advance of the 12px face at this size; SVG cannot ask for it before laying
	 * out, and measuring in a hidden node to find out is a lot of machinery for a
	 * rounded rectangle.
	 */
	const MARK_AND_PADDING = 46;
	function widthFor(label: string): number {
		return Math.max(132, Math.round(MARK_AND_PADDING + label.length * 6.4));
	}

	/**
	 * The optimal crossing solver is exponential, which is fine for an order's
	 * handful of lots and not fine in general. Past that size the two-layer
	 * heuristic gives a good arrangement instantly.
	 */
	const OPTIMAL_UP_TO = 12;

	/**
	 * The point halfway along a polyline, by length.
	 *
	 * Not the middle *vertex*: an edge with two points would put its label on the
	 * target, where a box then covers it — which is how two of the three weights
	 * went missing the first time this was drawn.
	 */
	function midpointOf(points: readonly (readonly [number, number])[]): [number, number] {
		const lengths = points.slice(1).map((point, index) => Math.hypot(
			point[0] - points[index][0],
			point[1] - points[index][1]
		));
		const half = lengths.reduce((sum, length) => sum + length, 0) / 2;

		let travelled = 0;
		for (const [index, length] of lengths.entries()) {
			if (travelled + length >= half) {
				const along = length === 0 ? 0 : (half - travelled) / length;
				const [x1, y1] = points[index];
				const [x2, y2] = points[index + 1];
				return [x1 + (x2 - x1) * along, y1 + (y2 - y1) * along];
			}
			travelled += length;
		}
		return [points[0][0], points[0][1]];
	}

	/**
	 * Trims an edge so it runs border to border rather than centre to centre.
	 *
	 * At the target end, an untrimmed edge hides its own arrowhead under the box
	 * — losing the one thing the diagram is for, which way the coffee went. At the
	 * source end, the midpoint of a short edge falls *inside* the box, taking its
	 * weight label with it.
	 */
	function trimEnds(
		points: (readonly [number, number])[],
		fromWidth: number,
		toWidth: number
	): (readonly [number, number])[] {
		const atTarget = clipToBox(points, toWidth);
		return clipToBox([...atTarget].reverse(), fromWidth).reverse();
	}

	/** Pulls the last point back to the boundary of the box it lands on. */
	function clipToBox(
		points: (readonly [number, number])[],
		boxWidth: number
	): (readonly [number, number])[] {
		if (points.length < 2) return points;

		const target = points[points.length - 1];
		const previous = points[points.length - 2];
		const dx = target[0] - previous[0];
		const dy = target[1] - previous[1];
		if (dx === 0 && dy === 0) return points;

		// How far back along the segment the box's border lies, whichever side the
		// edge arrives on.
		const scale = Math.min(
			Math.abs(dx) > 0 ? (boxWidth / 2 + 5) / Math.abs(dx) : Infinity,
			Math.abs(dy) > 0 ? (BOX.height / 2 + 5) / Math.abs(dy) : Infinity
		);

		return [
			...points.slice(0, -1),
			[target[0] - dx * scale, target[1] - dy * scale] as const
		];
	}

	/**
	 * Where an edge's weight goes: halfway along, pushed to the side.
	 *
	 * On the line itself a diagonal label reads across whatever it crosses, and a
	 * label centred on a short edge disappears under a box.
	 */
	function labelAt(points: (readonly [number, number])[]): [number, number] {
		const [x, y] = midpointOf(points);
		const [x1, y1] = points[0];
		const [x2, y2] = points[points.length - 1];
		const length = Math.hypot(x2 - x1, y2 - y1) || 1;

		// Perpendicular to the edge, always upwards so labels never sit under it.
		const offset = 11;
		return [x - ((y2 - y1) / length) * offset, y - Math.abs((x2 - x1) / length) * offset];
	}

	/** Every box's width, and the widest of them — which is what sets the gaps. */
	const widths = $derived(new Map(graph.nodes.map((node) => [node.id, widthFor(node.label)])));
	const widest = $derived(Math.max(132, ...widths.values()));

	const layout = $derived.by(() => {
		if (graph.edges.length === 0) return null;

		// d3-dag identifies nodes by string; ids are numbers here.
		const connect = graphConnect().sourceId((edge: string[]) => edge[0]).targetId(
			(edge: string[]) => edge[1]
		);
		const dag = connect(graph.edges.map((edge) => [String(edge.from), String(edge.to)]));

		const size = sugiyama()
			.layering(layeringSimplex())
			.decross(graph.nodes.length <= OPTIMAL_UP_TO ? decrossOpt() : decrossTwoLayer())
			.coord(coordSimplex())
			// Height first: the layout is vertical and gets transposed when drawn.
			// The widest box sets the spacing, so no two of them can collide.
			.nodeSize([BOX.height, widest])
			.gap([26, 56]);

		const { width, height } = size(dag as never);

		const byId = new Map(graph.nodes.map((node) => [String(node.id), node]));
		const nodes = [...dag.nodes()].map((node) => ({
			...byId.get(node.data as unknown as string)!,
			// Transposed: the layout's y becomes our x, so layers run rightwards.
			x: node.y,
			y: node.x
		}));

		const weightOf = new Map(
			graph.edges.map((edge) => [`${edge.from}·${edge.to}`, edge.kilos])
		);

		const links = [...dag.links()].map((link) => {
			const full = link.points.map(([x, y]) => [y, x] as const);
			const from = link.source.data as unknown as string;
			const to = link.target.data as unknown as string;
			const drawn = trimEnds(full, widths.get(Number(from)) ?? widest, widths.get(Number(to)) ?? widest);
			return {
				id: `${from}·${to}`,
				path: drawn.map((point, index) => `${index ? 'L' : 'M'}${point[0]},${point[1]}`).join(' '),
				// Measured on the drawn line, so the label sits on what is visible,
				// then pushed clear of it along the perpendicular.
				label: labelAt(drawn),
				kilos: weightOf.get(`${from}·${to}`) ?? 0
			};
		});

		// The transpose swaps the canvas too.
		return { nodes, links, width: height, height: width };
	});
</script>

{#if layout}
	<!-- Centred while it fits, scrollable when it does not: `mx-auto` on a box
	     wider than its container would clip the left edge instead. -->
	<div class="overflow-x-auto px-4 py-5">
		<svg
			width={layout.width + widest}
			height={layout.height + BOX.height}
			viewBox="{-widest / 2} {-BOX.height / 2} {layout.width + widest} {layout.height +
				BOX.height}"
			class="mx-auto block max-w-none"
			role="img"
			aria-label="Linaje de los lotes de esta orden"
		>
			<!-- Direction is the whole point of a lineage: coffee went this way. -->
			<defs>
				<marker
					id="lote-flecha"
					viewBox="0 0 8 8"
					refX="7"
					refY="4"
					markerWidth="6"
					markerHeight="6"
					orient="auto-start-reverse"
				>
					<path d="M0,1 L7,4 L0,7 Z" class="fill-border" />
				</marker>
			</defs>
			<!-- Edges first, so the boxes sit on top of them. -->
			{#each layout.links as link (link.id)}
				<path
					d={link.path}
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					marker-end="url(#lote-flecha)"
					class="text-border"
				/>
				<!--
					Painted with a halo of the surface colour: a weight sits wherever the
					line happens to run, and without this it is read across whatever
					crosses behind it.
				-->
				<text
					x={link.label[0]}
					y={link.label[1]}
					text-anchor="middle"
					class="fill-muted text-[9px] tabular-nums"
					style="paint-order: stroke; stroke: var(--surface); stroke-width: 4px;
						stroke-linejoin: round;"
				>
					{formatKilos(link.kilos)} kg
				</text>
			{/each}

			{#each layout.nodes as node (node.id)}
				{@const current = node.id === currentLotId}

				<!--
					The lot you are already on is drawn the same way but is not a link:
					clicking it would reload the page you are looking at, which reads as
					the diagram being broken.
				-->
				{@const width = widths.get(node.id) ?? widest}

				{#snippet box()}
					<rect
						x={node.x - width / 2}
						y={node.y - BOX.height / 2}
						width={width}
						height={BOX.height}
						rx="6"
						class="{current
							? 'fill-accent-soft stroke-accent'
							: 'fill-surface stroke-border group-hover:stroke-accent'} stroke-[1.5]"
					/>
					<!--
						Mark then label, both anchored to the left edge. Centring the text
						while the mark sits beside it leaves neither centred: the label
						reads as pushed off to one side.

						The icon is drawn directly rather than through LotMark, which wraps
						it in a <span> — HTML inside an <svg> is simply ignored, so that
						version rendered nothing here.
					-->
					{@const mark = lotMark(node.status)}
					{#if mark}
						<g
							transform="translate({node.x - width / 2 + 10}, {node.y - 7})"
							class={mark.class}
						>
							<Icon name={mark.icon} />
						</g>
					{/if}
					<text
						x={node.x - width / 2 + 32}
						y={node.y + 4}
						class="{current ? 'fill-accent font-semibold' : 'fill-text'} text-xs"
					>
						{node.label}
					</text>
				{/snippet}

				{#if current}
					<g aria-current="page">{@render box()}</g>
				{:else}
					<a href="/lotes/{node.code}" class="group">{@render box()}</a>
				{/if}
			{/each}

		</svg>
	</div>
{/if}
