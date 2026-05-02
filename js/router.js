const routes = {};

export function route(path, handler) {
  routes[path] = handler;
}

export function navigate(path) {
  window.location.hash = path;
}

export function startRouter() {
  function dispatch() {
    const hash = window.location.hash.slice(1) || '/';
    // Match exact or parameterized routes
    for (const [pattern, handler] of Object.entries(routes)) {
      const params = matchRoute(pattern, hash);
      if (params !== null) { handler(params); return; }
    }
    // Fallback to home
    if (routes['/']) routes['/']({});
  }
  window.addEventListener('hashchange', dispatch);
  dispatch();
}

function matchRoute(pattern, path) {
  const patParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patParts.length !== pathParts.length) return null;
  const params = {};
  for (let i = 0; i < patParts.length; i++) {
    if (patParts[i].startsWith(':')) {
      params[patParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (patParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}
