// Whether a path is INSIDE a route: the route itself or anything below it ("/agents" holds "/agents" and "/agents/x", NOT "/agents-new": a longer address that merely starts with the same letters is another
// page). Before F-320 the nav matched by the plain start of the text, so a page called "/agents-new" would have lit up "Agentic Platform" (/agents) too, as a hyphenated sibling of another section already did.

export const inRoute = (pathname: string, route: string): boolean => (route === '/' ? pathname === '/' : pathname === route || pathname.startsWith(route.endsWith('/') ? route : `${route}/`))
