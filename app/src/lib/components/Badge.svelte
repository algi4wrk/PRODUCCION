<script lang="ts">
	/** Status chip. Tone is chosen by the caller so this stays domain-agnostic. */
	let {
		text,
		tone = 'neutral'
	}: {
		text: string;
		tone?: 'neutral' | 'active' | 'paused' | 'done' | 'priority';
	} = $props();

	const TONES: Record<string, string> = {
		neutral: 'bg-border/40 text-muted',
		active: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
		paused: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
		done: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
		priority: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
	};
</script>

<span class="inline-block rounded-full px-2 py-0.5 text-xs font-medium {TONES[tone]}">
	{text}
</span>
