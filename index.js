const isObject = value => {
	const type = typeof value;
	return value !== null && (type === 'object' || type === 'function');
};

const isEmptyObject = value => isObject(value) && Object.keys(value).length === 0;

const disallowedKeys = new Set([
	'__proto__',
	'prototype',
	'constructor',
]);

const digits = new Set('0123456789');

function isValidArrayIndex(value) {
	return typeof value === 'string'
		&& /^\d+$/.test(value)
		&& Number.parseInt(value, 10) >= 0
		&& (value === '0' || !value.startsWith('0')); // Reject leading zeros except for '0' itself
}

function normalizeKey(key, object, pathIndex) {
	// Convert dot notation array indices to numbers (e.g., 'users.0' -> 'users', 0)
	// Only allow this when not the first path segment to preserve string index blocking
	if (pathIndex > 0 && typeof key === 'string' && Array.isArray(object) && isValidArrayIndex(key)) {
		return Number.parseInt(key, 10);
	}

	return key;
}

export function getPathSegments(path) {
	if (Array.isArray(path)) return path;

	const parts = [];
	let currentSegment = '';
	let currentPart = 'start';
	let isIgnoring = false;

	for (const character of path) {
		switch (character) {
			case '\\': {
				if (currentPart === 'index') {
					throw new Error('Invalid character in an index');
				}

				if (currentPart === 'indexEnd') {
					throw new Error('Invalid character after an index');
				}

				if (isIgnoring) {
					currentSegment += character;
				}

				currentPart = 'property';
				isIgnoring = !isIgnoring;
				break;
			}

			case '.': {
				if (currentPart === 'index') {
					throw new Error('Invalid character in an index');
				}

				if (currentPart === 'indexEnd') {
					currentPart = 'property';
					break;
				}

				if (isIgnoring) {
					isIgnoring = false;
					currentSegment += character;
					break;
				}

				if (disallowedKeys.has(currentSegment)) {
					return [];
				}

				parts.push(currentSegment);
				currentSegment = '';
				currentPart = 'property';
				break;
			}

			case '[': {
				if (currentPart === 'index') {
					throw new Error('Invalid character in an index');
				}

				if (currentPart === 'indexEnd') {
					currentPart = 'index';
					break;
				}

				if (isIgnoring) {
					isIgnoring = false;
					currentSegment += character;
					break;
				}

				if (currentPart === 'property') {
					if (disallowedKeys.has(currentSegment)) {
						return [];
					}

					parts.push(currentSegment);
					currentSegment = '';
				}

				currentPart = 'index';
				break;
			}

			case ']': {
				if (currentPart === 'index') {
					parts.push(Number.parseInt(currentSegment, 10));
					currentSegment = '';
					currentPart = 'indexEnd';
					break;
				}

				if (currentPart === 'indexEnd') {
					throw new Error('Invalid character after an index');
				}

				// Falls through
			}

			default: {
				if (currentPart === 'index' && !digits.has(character)) {
					throw new Error('Invalid character in an index');
				}

				if (currentPart === 'indexEnd') {
					throw new Error('Invalid character after an index');
				}

				if (currentPart === 'start') {
					currentPart = 'property';
				}

				if (isIgnoring) {
					isIgnoring = false;
					currentSegment += '\\';
				}

				currentSegment += character;
			}
		}
	}

	if (isIgnoring) {
		currentSegment += '\\';
	}

	switch (currentPart) {
		case 'property': {
			if (disallowedKeys.has(currentSegment)) {
				return [];
			}

			parts.push(currentSegment);

			break;
		}

		case 'index': {
			throw new Error('Index was not closed');
		}

		case 'start': {
			parts.push('');

			break;
		}
		// No default
	}

	return parts;
}

function isStringIndex(object, key) {
	if (!Array.isArray(object) || typeof key === 'number') {
		return false;
	}

	// Block canonical numeric strings only: '0', '12', not '00' or '01'
	const parsed = Number.parseInt(key, 10);
	return Number.isInteger(parsed) && String(parsed) === key;
}

function assertNotStringIndex(object, key) {
	if (isStringIndex(object, key)) {
		throw new Error('Cannot use string index');
	}
}

export function getProperty(object, path, value) {
	if (!isObject(object) || typeof path !== 'string' && !Array.isArray(path)) {
		return value === undefined ? object : value;
	}

	const pathArray = getPathSegments(path);
	if (pathArray.length === 0) {
		return value;
	}

	for (let index = 0; index < pathArray.length; index++) {
		const key = pathArray[index];
		const normalizedKey = normalizeKey(key, object, index);

		// Only check for string index if we're not using a normalized (converted) key
		if (normalizedKey === key && isStringIndex(object, key)) {
			object = index === pathArray.length - 1 ? undefined : null;
		} else {
			object = object[normalizedKey];
		}

		if (object === undefined || object === null) {
			// `object` is either `undefined` or `null` so we want to stop the loop, and
			// if this is not the last bit of the path, and
			// if it didn't return `undefined`
			// it would return `null` if `object` is `null`
			// but we want `get({foo: null}, 'foo.bar')` to equal `undefined`, or the supplied value, not `null`
			if (index !== pathArray.length - 1) {
				return value;
			}

			break;
		}
	}

	return object === undefined ? value : object;
}

export function setProperty(object, path, value) {
	if (!isObject(object) || typeof path !== 'string' && !Array.isArray(path)) {
		return object;
	}

	const root = object;
	const pathArray = getPathSegments(path);

	for (let index = 0; index < pathArray.length; index++) {
		const key = pathArray[index];
		const normalizedKey = normalizeKey(key, object, index);

		// Only check for string index if we're not using a normalized (converted) key
		if (normalizedKey === key) {
			assertNotStringIndex(object, key);
		}

		if (index === pathArray.length - 1) {
			object[normalizedKey] = value;
		} else if (!isObject(object[normalizedKey])) {
			const nextKey = pathArray[index + 1];
			const shouldCreateArray = typeof nextKey === 'number'
				|| (typeof nextKey === 'string' && isValidArrayIndex(nextKey));
			object[normalizedKey] = shouldCreateArray ? [] : {};
		}

		object = object[normalizedKey];
	}

	return root;
}

export function deleteProperty(object, path) {
	if (!isObject(object) || typeof path !== 'string' && !Array.isArray(path)) {
		return false;
	}

	const pathArray = getPathSegments(path);

	for (let index = 0; index < pathArray.length; index++) {
		const key = pathArray[index];
		const normalizedKey = normalizeKey(key, object, index);

		// Only check for string index if we're not using a normalized (converted) key
		if (normalizedKey === key) {
			assertNotStringIndex(object, key);
		}

		if (index === pathArray.length - 1) {
			const existed = Object.hasOwn(object, normalizedKey);
			if (!existed) {
				return false;
			}

			delete object[normalizedKey];
			return true;
		}

		object = object[normalizedKey];

		if (!isObject(object)) {
			return false;
		}
	}
}

export function hasProperty(object, path) {
	if (!isObject(object) || typeof path !== 'string' && !Array.isArray(path)) {
		return false;
	}

	const pathArray = getPathSegments(path);
	if (pathArray.length === 0) {
		return false;
	}

	for (const [index, key] of pathArray.entries()) {
		const normalizedKey = normalizeKey(key, object, index);

		// Only check for string index if we're not using a normalized (converted) key
		const shouldCheckStringIndex = normalizedKey === key && isStringIndex(object, key);

		if (!isObject(object) || !(normalizedKey in object) || shouldCheckStringIndex) {
			return false;
		}

		object = object[normalizedKey];
	}

	return true;
}

// TODO: Backslashes with no effect should not be escaped
export function escapePath(path) {
	if (typeof path !== 'string') {
		throw new TypeError('Expected a string');
	}

	return path.replaceAll(/[\\.[]/g, String.raw`\$&`);
}

// The keys returned by Object.entries() for arrays are strings
function entries(value) {
	const result = Object.entries(value);
	if (Array.isArray(value)) {
		return result.map(([key, value]) => [Number(key), value]);
	}

	return result;
}

function stringifyPath(pathSegments) {
	let result = '';

	for (let [index, segment] of entries(pathSegments)) {
		if (typeof segment === 'number') {
			result += `[${segment}]`;
		} else {
			segment = escapePath(segment);
			result += index === 0 ? segment : `.${segment}`;
		}
	}

	return result;
}

function* deepKeysIterator(object, currentPath = []) {
	if (!isObject(object) || isEmptyObject(object)) {
		if (currentPath.length > 0) {
			yield stringifyPath(currentPath);
		}

		return;
	}

	for (const [key, value] of entries(object)) {
		yield* deepKeysIterator(value, [...currentPath, key]);
	}
}

export function deepKeys(object) {
	return [...deepKeysIterator(object)];
}

export function unflatten(object) {
	const result = {};
	if (!isObject(object)) {
		return result;
	}

	for (const [path, value] of Object.entries(object)) {
		setProperty(result, path, value);
	}

	return result;
}
