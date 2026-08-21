import { resolve } from 'node:path';
import { compileString } from 'sass';

/**
 * Success and error are the highest-stakes color pair in the product, and
 * red/green is the pair most people with a color vision deficiency cannot
 * separate. The `accessible` palette exists to give those two states a second,
 * non-hue channel to differ on.
 *
 * The trap this guards against: swapping green for blue *feels* like the fix,
 * but simulated against dichromacy it buys almost nothing on its own — today's
 * green/red and a naive blue/red score within 0.001 of each other. What
 * actually helps is luminance separation. So the assertions below are
 * relative: the accessible palette must beat the default on the luminance
 * channel, without giving up ground on the hue channel.
 *
 * Simulation is Vienot, Brettel & Mollon (1999) applied to linear sRGB, plus a
 * partial-severity mix to approximate anomalous trichromacy, which is what most
 * people described as "red-green colorblind" actually have.
 */

const cssDir = resolve(process.cwd(), 'src/css');

type Vec = [number, number, number];

const cube = (x: number) => x * x * x;
const clamp = (x: number) => Math.min(1, Math.max(0, x));

function oklchToLinear(l: number, c: number, hDeg: number): Vec {
	const h = (hDeg * Math.PI) / 180;
	const [a, b] = [c * Math.cos(h), c * Math.sin(h)];
	const [lc, mc, sc] = [
		cube(l + 0.3963377774 * a + 0.2158037573 * b),
		cube(l - 0.1055613458 * a - 0.0638541728 * b),
		cube(l - 0.089484177 * a - 1.291485548 * b),
	];
	return [
		4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
		-1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
		-0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc,
	];
}

function linearToOklab([r, g, b]: Vec): Vec {
	const [l, m, s] = [
		Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b),
		Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
		Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b),
	];
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
}

const SIMULATIONS: Record<string, [Vec, Vec, Vec]> = {
	protanopia: [
		[0, 1.05118294, -0.05116099],
		[0, 1, 0],
		[0, 0, 1],
	],
	deuteranopia: [
		[1, 0, 0],
		[0.9513092, 0, 0.04866992],
		[0, 0, 1],
	],
	tritanopia: [
		[1, 0, 0],
		[0, 1, 0],
		[-0.86744736, 1.86727089, 0],
	],
};

const applyMatrix = (m: [Vec, Vec, Vec], v: Vec): Vec =>
	m.map((row) => row.reduce((sum, k, i) => sum + k * v[i], 0)) as Vec;

/** Anomalous trichromacy sits between normal vision and the dichromat pole. */
const partial = (m: [Vec, Vec, Vec], v: Vec, severity: number): Vec => {
	const full = applyMatrix(m, v);
	return v.map((x, i) => x * (1 - severity) + full[i] * severity) as Vec;
};

const deltaOklab = (a: Vec, b: Vec) => {
	const [x, y] = [linearToOklab(a.map(clamp) as Vec), linearToOklab(b.map(clamp) as Vec)];
	return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

const relativeLuminance = ([r, g, b]: Vec) =>
	0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b);

const contrastRatio = (a: Vec, b: Vec) => {
	const [x, y] = [relativeLuminance(a) + 0.05, relativeLuminance(b) + 0.05];
	return Math.max(x, y) / Math.min(x, y);
};

/** Worst case across every deficiency we simulate, including normal vision. */
function worstHueSeparation(a: Vec, b: Vec) {
	const scores = [deltaOklab(a, b)];
	for (const m of Object.values(SIMULATIONS)) {
		scores.push(deltaOklab(applyMatrix(m, a), applyMatrix(m, b)));
		scores.push(deltaOklab(partial(m, a, 0.6), partial(m, b, 0.6)));
	}
	return Math.min(...scores);
}

// --- read the palettes out of the compiled stylesheet -----------------------

const css = compileString("@use 'primitives.scss';\n@use 'tokens.scss';\n", {
	loadPaths: [cssDir],
})
	.css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Top-level rules only. A selector appears in several blocks across the
 * stylesheet, and at-rule bodies are skipped so the cascade modelled here is
 * the explicit [data-theme] path rather than the prefers-color-scheme one.
 */
function topLevelRules(): Array<[string, string]> {
	const rules: Array<[string, string]> = [];
	let cursor = 0;

	while (cursor < css.length) {
		const open = css.indexOf('{', cursor);
		if (open === -1) break;

		const selector = css.slice(cursor, open).trim();
		let depth = 1;
		let scan = open + 1;
		while (scan < css.length && depth > 0) {
			if (css[scan] === '{') depth++;
			else if (css[scan] === '}') depth--;
			scan++;
		}

		if (!selector.startsWith('@')) rules.push([selector, css.slice(open + 1, scan - 1)]);
		cursor = scan;
	}

	return rules;
}

const RULES = topLevelRules();

function declarationsFor(selector: string): Map<string, string> {
	const bodies = RULES.filter(([candidate]) => candidate === selector).map(([, body]) => body);
	expect(bodies.length, `selector ${selector} missing from compiled CSS`).toBeGreaterThan(0);

	const declarations = new Map<string, string>();
	for (const body of bodies) {
		for (const [, prop, value] of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
			declarations.set(prop, value.replace(/\s+/g, ' ').trim());
		}
	}
	expect(declarations.size, `no custom properties under ${selector}`).toBeGreaterThan(0);
	return declarations;
}

/** Later layers win, which is how the real cascade resolves these selectors. */
function cascade(...selectors: string[]): Map<string, string> {
	const merged = new Map<string, string>();
	for (const selector of selectors) {
		for (const [prop, value] of declarationsFor(selector)) merged.set(prop, value);
	}
	return merged;
}

const OKLCH = /^oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)$/;

function resolve_(tokens: Map<string, string>, name: string, seen = new Set<string>()): Vec {
	expect(seen.has(name), `circular token reference at ${name}`).toBe(false);
	seen.add(name);

	const value = tokens.get(name);
	expect(value, `token ${name} is not defined`).toBeDefined();

	const literal = OKLCH.exec(value!);
	if (literal) {
		return oklchToLinear(Number(literal[1]) / 100, Number(literal[2]), Number(literal[3]));
	}

	// var(--a) or var(--a, var(--b)) — take the first arm that is actually defined.
	const reference = /^var\((--[\w-]+)(?:,\s*(.+))?\)$/.exec(value!);
	expect(reference, `token ${name} has unparsable value: ${value}`).not.toBeNull();
	const [, primary, fallback] = reference!;
	if (tokens.has(primary)) return resolve_(tokens, primary, seen);

	expect(fallback, `token ${name} has no defined arm`).toBeDefined();
	const nested = /^var\((--[\w-]+)\)$/.exec(fallback.trim());
	expect(nested, `token ${name} fallback is unparsable: ${fallback}`).not.toBeNull();
	return resolve_(tokens, nested![1], seen);
}

const PALETTES = {
	'light / default': cascade(':root'),
	'light / accessible': cascade(':root', '[data-color-vision=accessible]'),
	'dark / default': cascade(':root', '[data-theme=dark]'),
	'dark / accessible': cascade(
		':root',
		'[data-theme=dark]',
		'[data-color-vision=accessible]',
		'[data-theme=dark][data-color-vision=accessible]',
	),
};

const PAIRS = {
	semantic: ['--color--success', '--color--danger'],
	'execution card stripe': [
		'--execution-card--border-color--success',
		'--execution-card--border-color--error',
	],
} as const;

function measure(palette: keyof typeof PALETTES, pair: keyof typeof PAIRS) {
	const tokens = PALETTES[palette];
	const [success, danger] = PAIRS[pair].map((token) => resolve_(tokens, token));
	return { hue: worstHueSeparation(success, danger), luminance: contrastRatio(success, danger) };
}

describe('status color separation', () => {
	describe.each(['light', 'dark'] as const)('%s theme', (theme) => {
		it.each(Object.keys(PAIRS) as Array<keyof typeof PAIRS>)(
			'accessible palette widens the luminance gap for the %s pair',
			(pair) => {
				const base = measure(`${theme} / default`, pair);
				const accessible = measure(`${theme} / accessible`, pair);

				expect(accessible.luminance).toBeGreaterThan(base.luminance);
			},
		);

		it.each(Object.keys(PAIRS) as Array<keyof typeof PAIRS>)(
			'accessible palette holds its ground on hue for the %s pair',
			(pair) => {
				const base = measure(`${theme} / default`, pair);
				const accessible = measure(`${theme} / accessible`, pair);

				// Trading a little hue for luminance is the design; collapsing hue is not.
				expect(accessible.hue).toBeGreaterThan(base.hue - 0.03);
			},
		);
	});

	it.each(['light', 'dark'] as const)(
		'accessible success color stays legible as text in the %s theme',
		(theme) => {
			const tokens = PALETTES[`${theme} / accessible`];
			const background = resolve_(tokens, '--color--background--light-3');
			const success = resolve_(tokens, '--color--success');

			expect(contrastRatio(success, background)).toBeGreaterThanOrEqual(4.5);
		},
	);
});
