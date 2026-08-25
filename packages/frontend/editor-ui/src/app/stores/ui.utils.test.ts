import { LOCAL_STORAGE_COLOR_VISION } from '@/app/constants';
import {
	applyColorVisionToBody,
	getColorVisionOverride,
	isValidColorVision,
} from './ui.utils';

describe('ui.utils', () => {
	describe('applyColorVisionToBody', () => {
		afterEach(() => {
			document.body.removeAttribute('data-color-vision');
		});

		it('sets the attribute for the accessible palette', () => {
			applyColorVisionToBody('accessible');

			expect(document.body.getAttribute('data-color-vision')).toBe('accessible');
		});

		it('removes the attribute for the default palette, so no CSS override applies', () => {
			applyColorVisionToBody('accessible');
			applyColorVisionToBody('default');

			expect(document.body.hasAttribute('data-color-vision')).toBe(false);
		});
	});

	describe('isValidColorVision', () => {
		it.each([
			['accessible', true],
			['default', true],
			['deuteranopia', false],
			['', false],
			[null, false],
		])('treats %s as valid: %s', (value, expected) => {
			expect(isValidColorVision(value)).toBe(expected);
		});
	});

	describe('getColorVisionOverride', () => {
		afterEach(() => {
			localStorage.clear();
		});

		it('reads a stored preference', () => {
			localStorage.setItem(LOCAL_STORAGE_COLOR_VISION, 'accessible');

			expect(getColorVisionOverride()).toBe('accessible');
		});

		it('ignores an unrecognized stored value', () => {
			localStorage.setItem(LOCAL_STORAGE_COLOR_VISION, 'tritanopia');

			expect(getColorVisionOverride()).toBe(null);
		});

		it('returns null when nothing is stored', () => {
			expect(getColorVisionOverride()).toBe(null);
		});
	});
});
