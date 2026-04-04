const API_ROOT = '/api/v1';

function trimTrailingSlashes(value: string): string {
    return value.trim().replace(/\/+$/, '');
}

export function normalizeRelayerOrigin(value: string): string {
    const trimmed = trimTrailingSlashes(value);
    if (!trimmed) {
        return '';
    }

    if (trimmed.startsWith('/')) {
        return trimmed.replace(/\/api\/v1$/i, '');
    }

    try {
        const url = new URL(trimmed);
        url.pathname = url.pathname.replace(/\/api\/v1$/i, '').replace(/\/+$/, '');
        return url.toString().replace(/\/+$/, '');
    } catch {
        return trimmed.replace(/\/api\/v1$/i, '');
    }
}

export function buildRelayerApiUrl(baseUrl: string, path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const trimmed = trimTrailingSlashes(baseUrl);

    if (!trimmed) {
        return `${API_ROOT}${normalizedPath}`;
    }

    if (trimmed.startsWith('/')) {
        if (/\/api\/v1$/i.test(trimmed) || /\/api\/auth\/relay$/i.test(trimmed)) {
            return `${trimmed}${normalizedPath}`;
        }

        return `${trimmed}${normalizedPath}`;
    }

    try {
        const url = new URL(trimmed);

        if (/\/api\/v1$/i.test(url.pathname) || /\/api\/auth\/relay$/i.test(url.pathname)) {
            url.pathname = `${url.pathname.replace(/\/+$/, '')}${normalizedPath}`;
            return url.toString();
        }

        if (!url.pathname || url.pathname === '/') {
            url.pathname = `${API_ROOT}${normalizedPath}`;
            return url.toString();
        }

        url.pathname = `${url.pathname.replace(/\/+$/, '')}${normalizedPath}`;
        return url.toString();
    } catch {
        if (/\/api\/v1$/i.test(trimmed) || /\/api\/auth\/relay$/i.test(trimmed)) {
            return `${trimmed}${normalizedPath}`;
        }

        return `${trimmed}${API_ROOT}${normalizedPath}`;
    }
}
