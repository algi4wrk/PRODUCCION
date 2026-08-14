/**
 * PERSONAL lookups.
 *
 * A person's history is not queried here: every event names its responsable as
 * a reference, so the five existing list functions answer it by filter. This
 * file only resolves the person themselves.
 */

import { eq } from 'drizzle-orm';
import { db } from './db/index.ts';
import { staff } from './db/schema.ts';

export async function getStaff(id: number) {
	const [person] = await db.select().from(staff).where(eq(staff.id, id)).limit(1);
	return person ?? null;
}
