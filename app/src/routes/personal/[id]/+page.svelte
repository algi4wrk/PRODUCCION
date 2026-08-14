<script lang="ts">
	/**
	 * One person's page: who they are, and everything they have recorded.
	 *
	 * Reached from any Responsable in the app — a name in a record is a way into
	 * the person, the same way a lot in a record is a way into the lot.
	 *
	 * The history is the same set of sections the order and lot pages show, given
	 * this person's events instead of an order's. So a row opens the process event
	 * it names, in the detail view that already exists, and the columns read the
	 * same everywhere. They are read-only here: this is a record of what someone
	 * did, not a place to unwind production.
	 *
	 * Sections with nothing in them are hidden. Elsewhere an empty section says
	 * "this order still needs hulling"; here it would only say that this person
	 * has never hulled anything.
	 */
	import FactGrid from '$lib/components/FactGrid.svelte';
	import Section from '$lib/components/Section.svelte';
	import TrillaSection from '$lib/components/proceso/TrillaSection.svelte';
	import SeleccionSection from '$lib/components/proceso/SeleccionSection.svelte';
	import TostionSection from '$lib/components/proceso/TostionSection.svelte';
	import EmpaqueSection from '$lib/components/proceso/EmpaqueSection.svelte';
	import MovimientoList from '$lib/components/movimiento/MovimientoList.svelte';

	let { data } = $props();
</script>

<div class="mb-6 flex flex-wrap items-center gap-3">
	<h1 class="text-xl font-semibold text-text">{data.person.name}</h1>
</div>

<div class="flex flex-col gap-6">
	<Section title="Resumen">
		<div class="px-4 py-4">
			<FactGrid facts={data.details} />
		</div>
	</Section>

	{#if data.trillas.length > 0}
		<TrillaSection events={data.trillas} showOrder readonly />
	{/if}
	{#if data.greenSelecciones.length > 0}
		<SeleccionSection
			title="Selección — Almendra verde"
			stage="VERDE"
			events={data.greenSelecciones}
			showOrder
			readonly
		/>
	{/if}
	{#if data.tostiones.length > 0}
		<TostionSection events={data.tostiones} showOrder readonly />
	{/if}
	{#if data.roastedSelecciones.length > 0}
		<SeleccionSection
			title="Selección — Tostado"
			stage="TOSTADO"
			events={data.roastedSelecciones}
			showOrder
			readonly
		/>
	{/if}
	{#if data.empaques.length > 0}
		<EmpaqueSection events={data.empaques} showOrder readonly />
	{/if}
	{#if data.movements.length > 0}
		<Section title="Movimientos de lotes" count={data.movements.length}>
			<MovimientoList movements={data.movements} showOrder readonly />
		</Section>
	{/if}
</div>
