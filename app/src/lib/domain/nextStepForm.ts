/**
 * Which form a lot's next step opens.
 *
 * The board and the order page both say what a lot needs next; this turns that
 * sentence into the form that does it, so the step can be pressed instead of
 * read and then found. Steps that are not work — TERMINADO, COMBINADO, BODEGA,
 * EN GRANEL — map to nothing, and are shown as a plain chip.
 */
export type StepForm = 'trilla' | 'seleccionVerde' | 'seleccionTostado' | 'tostion' | 'empaque';

export function formForStep(step: string): StepForm | null {
	if (step.includes('TRILLAR')) return 'trilla';
	// Roasted sorting says so; anything else that sorts is the green one.
	if (step.includes('SELECCION TOSTADO')) return 'seleccionTostado';
	if (step.includes('SELECCION')) return 'seleccionVerde';
	if (step.includes('TOSTION') || step.includes('TOSTAR')) return 'tostion';
	if (step.includes('EMPAQUE') || step.includes('EMPACAR') || step.includes('MOLIENDA')) {
		return 'empaque';
	}
	return null;
}
