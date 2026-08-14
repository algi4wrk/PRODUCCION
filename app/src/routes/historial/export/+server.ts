import ExcelJS from 'exceljs';
import { HISTORY_VIEWS } from '$lib/domain/historial';
import { parseQuery, runQuery } from '$lib/server/historial';

/**
 * The current HISTORIAL query, as a file.
 *
 * It takes the same URL the page does and runs the same query, so what is
 * downloaded is what was on screen — same view, same filters, same columns, in
 * the same order. That is the whole reason the query lives in the URL.
 *
 * XLSX by default, because the people who receive these open them in Excel and
 * sort — and a workbook carries its own types. CSV is offered too, for whatever
 * has to read it as text, and it is written the way Excel expects Spanish
 * numbers: semicolon-delimited, with a BOM, because the comma here is a decimal
 * separator and a comma-delimited file of Colombian weights is unreadable.
 */
export async function GET({ url }) {
	const query = parseQuery(url.searchParams);
	const result = await runQuery(query);

	const view = HISTORY_VIEWS.find((option) => option.value === query.view)!;

	/** What the file is called on their disk: view, and what narrowed it. */
	const name = [
		'produccion',
		query.view,
		url.searchParams.get('desde'),
		url.searchParams.get('hasta')
	]
		.filter(Boolean)
		.join('-');

	const heading = (column: (typeof result.columns)[number]) =>
		column.unit ? `${column.label} (${column.unit})` : column.label;

	if (url.searchParams.get('formato') === 'csv') {
		const escape = (value: string) =>
			// Semicolons and quotes have to survive the trip; a cell holding either
			// is quoted, and a quote inside it is doubled.
			/[";\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

		const lines = [
			result.columns.map((column) => escape(heading(column))).join(';'),
			...result.rows.map((row) =>
				result.columns.map((column) => escape(row[column.key] ?? '')).join(';')
			)
		];

		// The BOM is what tells Excel the file is UTF-8; without it the accents
		// arrive as mojibake.
		return new Response(`\ufeff${lines.join('\r\n')}`, {
			headers: {
				'content-type': 'text/csv; charset=utf-8',
				'content-disposition': `attachment; filename="${name}.csv"`
			}
		});
	}

	const workbook = new ExcelJS.Workbook();
	workbook.creator = 'PRODUCCIÓN';
	workbook.created = new Date();

	const sheet = workbook.addWorksheet(view.label.slice(0, 31));

	sheet.columns = result.columns.map((column) => ({
		header: heading(column),
		key: column.key,
		// Wide enough for the heading and a typical value; Excel will not size
		// itself, and a sheet of ### is worse than a sheet that is slightly wide.
		width: Math.max(12, column.label.length + 4)
	}));

	for (const row of result.rows) sheet.addRow(row);

	// The heading row, so a long list stays readable once it is scrolled.
	sheet.getRow(1).font = { bold: true };
	sheet.views = [{ state: 'frozen', ySplit: 1 }];
	sheet.autoFilter = {
		from: { row: 1, column: 1 },
		to: { row: 1, column: result.columns.length }
	};

	const buffer = await workbook.xlsx.writeBuffer();

	return new Response(buffer, {
		headers: {
			'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'content-disposition': `attachment; filename="${name}.xlsx"`
		}
	});
}
