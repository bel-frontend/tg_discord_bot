export function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

export function html(body: string, status = 200): Response {
    return new Response(body, {
        status,
        headers: { 'content-type': 'text/html; charset=utf-8' },
    });
}

export function empty(status = 200): Response {
    return new Response(null, { status });
}

export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
