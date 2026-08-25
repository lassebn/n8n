import { LOCAL_STORAGE_COLOR_VISION, LOCAL_STORAGE_THEME } from '@/app/constants';
import type { AppliedThemeOption, ColorVisionOption, ThemeOption } from '@/Interface';

export function applyThemeToBody(theme: ThemeOption, window_?: Window) {
	if (theme === 'system') {
		(window_ ?? window).document.body.removeAttribute('data-theme');
	} else {
		(window_ ?? window).document.body.setAttribute?.('data-theme', theme); // setAttribute can be missing in jsdom environment
	}
}

export function isValidTheme(theme: string | null): theme is AppliedThemeOption {
	return !!theme && ['light', 'dark'].includes(theme);
}

// query param allows overriding theme for demo view in preview iframe without flickering
export function getThemeOverride(): AppliedThemeOption | null {
	const override = getQueryParam('theme') ?? localStorage.getItem(LOCAL_STORAGE_THEME);

	return isValidTheme(override) ? override : null;
}

export function applyColorVisionToBody(mode: ColorVisionOption, window_?: Window) {
	const body = (window_ ?? window).document.body;
	if (mode === 'default') {
		body.removeAttribute('data-color-vision');
	} else {
		body.setAttribute?.('data-color-vision', mode); // setAttribute can be missing in jsdom environment
	}
}

export function isValidColorVision(mode: string | null): mode is ColorVisionOption {
	return !!mode && ['default', 'accessible'].includes(mode);
}

export function getColorVisionOverride(): ColorVisionOption | null {
	const override = getQueryParam('colorVision') ?? localStorage.getItem(LOCAL_STORAGE_COLOR_VISION);

	return isValidColorVision(override) ? override : null;
}

function getQueryParam(paramName: string): string | null {
	return new URLSearchParams(window.location.search).get(paramName);
}
