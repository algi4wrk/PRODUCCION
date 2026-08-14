/** Entry point for `npm run db:seed`. */
import { seed } from '../src/lib/server/db/seed.ts';

const result = seed();

console.log('Base de datos poblada:');
for (const [key, value] of Object.entries(result)) {
	if (Array.isArray(value)) {
		console.log(`  ${key}: ${value.length} (${value.join(', ')})`);
	} else {
		console.log(`  ${key}: ${value}`);
	}
}
