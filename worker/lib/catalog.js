import catalog from '../../catalog/products.json';
import { HttpError } from './http.js';

export const currency = catalog.currency.toLowerCase();

// Client-sent names/prices are ignored entirely; prices come from the server-side catalog.
export function resolveCart(items) {
	if (!Array.isArray(items) || items.length === 0 || items.length > 50) throw new HttpError(400, 'Your cart is empty.');

	const quantities = new Map();
	for (const item of items) {
		const qty = Number.parseInt(item?.qty, 10);
		if (typeof item?.id !== 'string' || !(qty >= 1 && qty <= 99)) throw new HttpError(400, 'Invalid cart item.');
		quantities.set(item.id, Math.min((quantities.get(item.id) || 0) + qty, 99));
	}

	const lines = [...quantities].map(([id, qty]) => {
		const product = catalog.products.find((p) => p.id === id && p.active !== false);
		if (!product) throw new HttpError(400, 'An item in your cart is no longer available.');
		return { product, qty };
	});

	return {
		currency,
		lines,
		total: lines.reduce((sum, { product, qty }) => sum + product.price * qty, 0),
		shippingCountries: catalog.shippingCountries || [],
	};
}
