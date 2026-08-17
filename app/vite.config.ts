import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	/**
	 * Dev server only — `node build` never reads this.
	 *
	 * Vite rejects requests whose Host header it does not recognise, which is
	 * what stops a phone reaching `npm run dev -- --host` by machine name. The
	 * leading dot allows any `*.local` name, the mDNS names machines on a home
	 * or mill network answer to; IP addresses are allowed already.
	 */
	server: {
		allowedHosts: ['.local']
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-node: the app is served by a Node process on one of the mill's
			// own computers, not by a platform. `npm run build` then `node build`.
			adapter: adapter()
		})
	]
});
