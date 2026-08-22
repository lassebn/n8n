import { resolve } from 'node:path';
import { compileString } from 'sass';

/**
 * Success and error are the highest-stakes color pair in the product, and
 * red/green is the pair most people with a color vision deficiency cannot
 * separate. The `accessible` palette exists to give those two states a second,
 * non-hue channel to differ on.
 *
 * The model matters more than it looks. Vienot, Brettel & Mollon (1999) is a
 * dichromat projection, and for saturated green-vs-red it reports a large
 * difference that anomalous trichromats do not actually get - it projects the
 * two colors to opposite ends of the surviving axis. Using it here produced the
 * wrong conclusion: that swapping green for blue buys nothing.
 *
 * Machado, Oliveira & Fernandes (2009) is severity-parameterised and models
 * anomalous trichromacy directly, which is what most people described as
 * red-green colorblind actually have. Under it, n8n's default green/red status
 * pair collapses to dOKLab 0.047-0.13 depending on severity - indistinguishable
 * - while blue/red holds at ~0.36 across every severity. That is the whole
 * justification for the accessible palette, so it is what these tests assert.
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

/** Machado et al. (2009), linear-RGB matrices at four severities. */
const SIMULATIONS: Record<string, [Vec, Vec, Vec]> = {
	'deuteranomaly-0.4': [
		[0.632009, 0.480635, -0.112644],
		[0.144296, 0.81965, 0.036054],
		[-0.006494, 0.019067, 0.987427],
	],
	'deuteranomaly-0.6': [
		[0.547494, 0.607765, -0.155259],
		[0.181692, 0.781742, 0.036566],
		[-0.01041, 0.027275, 0.983136],
	],
	'deuteranomaly-1.0': [
		[0.367322, 0.860646, -0.227968],
		[0.280085, 0.672501, 0.047413],
		[-0.01182, 0.04294, 0.968881],
	],
	'protanomaly-0.4': [
		[0.575181, 0.526296, -0.101477],
		[0.071432, 0.880143, 0.048425],
		[-0.006724, 0.007204, 0.99952],
	],
	'protanomaly-0.6': [
		[0.38545, 0.769005, -0.154455],
		[0.100526, 0.829802, 0.069673],
		[-0.00795, -0.017991, 1.025941],
	],
	'protanomaly-1.0': [
		[0.152286, 1.052583, -0.204868],
		[0.114503, 0.786281, 0.099216],
		[-0.003882, -0.048116, 1.051998],
	],
	tritanomaly: [
		[1.255528, -0.076749, -0.178779],
		[-0.078411, 0.930809, 0.147602],
		[0.004733, 0.691367, 0.3039],
	],
};

const applyMatrix = (m: [Vec, Vec, Vec], v: Vec): Vec =>
	m.map((row) => row.reduce((sum, k, i) => sum + k * v[i], 0)) as Vec;

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
function worstSeparation(a: Vec, b: Vec) {
	const scores = [deltaOklab(a, b)];
	for (const m of Object.values(SIMULATIONS)) {
		scores.push(deltaOklab(applyMatrix(m, a), applyMatrix(m, b)));
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

/**
 * Success does not only have to differ from error. The execution card paints a
 * stripe per status, and the default palette's worst collision is actually
 * success against running (green-300 vs gold-200, 0.030) rather than success
 * against error.
 *
 * Only the success pairs are asserted here, because success is the only stripe
 * this palette retints. waiting/running/unknown collide with each other in both
 * palettes (0.06-0.12) and untangling them is a design decision about the whole
 * status set, not something to smuggle in behind an accessibility flag.
 *
 * That limit is itself informative: five statuses cannot all clear the bar,
 * because a dichromat has roughly two usable dimensions. Color alone does not
 * scale to five states - which is why the icons ship unconditionally.
 */
const STRIPE_TOKENS = {
	success: '--execution-card--border-color--success',
	error: '--execution-card--border-color--error',
	waiting: '--execution-card--border-color--waiting',
	running: '--execution-card--border-color--running',
	unknown: '--execution-card--border-color--unknown',
} as const;

function measure(palette: keyof typeof PALETTES, pair: keyof typeof PAIRS) {
	const tokens = PALETTES[palette];
	const [success, danger] = PAIRS[pair].map((token) => resolve_(tokens, token));
	return {
		separation: worstSeparation(success, danger),
		luminance: contrastRatio(success, danger),
	};
}

/**
 * 0.20 dOKLab is the floor for "two small shapes read as different colors".
 * The default palette sits well under it for every red-green deficiency, which
 * is the bug; the accessible palette must clear it.
 */
const USABLE_SEPARATION = 0.2;

/**
 * Success/error is the pair that carries the decision, so it gets the full bar.
 * The remaining stripes still have to be told apart, but confusing "waiting"
 * with "running" costs a glance rather than a wrong conclusion.
 */
const SIBLING_SEPARATION = 0.15;

describe('status color separation', () => {
	describe.each(['light', 'dark'] as const)('%s theme, accessible palette', (theme) => {
		const tokens = PALETTES[`${theme} / accessible`];
		const siblings = (Object.keys(STRIPE_TOKENS) as Array<keyof typeof STRIPE_TOKENS>).filter(
			(name) => name !== 'success',
		);

		it.each(siblings)('separates the success stripe from the %s stripe', (sibling) => {
			const separation = worstSeparation(
				resolve_(tokens, STRIPE_TOKENS.success),
				resolve_(tokens, STRIPE_TOKENS[sibling]),
			);

			expect(separation).toBeGreaterThan(SIBLING_SEPARATION);
		});
	});

	describe.each(['light', 'dark'] as const)('%s theme', (theme) => {
		it.each(Object.keys(PAIRS) as Array<keyof typeof PAIRS>)(
			'accessible palette stays distinguishable for the %s pair under every simulated deficiency',
			(pair) => {
				const accessible = measure(`${theme} / accessible`, pair);

				expect(accessible.separation).toBeGreaterThan(USABLE_SEPARATION);
			},
		);

		it.each(Object.keys(PAIRS) as Array<keyof typeof PAIRS>)(
			'accessible palette beats the default it replaces for the %s pair',
			(pair) => {
				const base = measure(`${theme} / default`, pair);
				const accessible = measure(`${theme} / accessible`, pair);

				expect(accessible.separation).toBeGreaterThan(base.separation);
				// Luminance is the fallback channel for grayscale and achromatopsia, so
				// it gets a floor rather than a comparison - hue is what carries this.
				expect(accessible.luminance).toBeGreaterThan(1.25);
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
