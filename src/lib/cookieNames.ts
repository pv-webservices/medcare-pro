/**
 * Cookie names shared between server and client code.
 *
 * Deliberately free of imports: the client-side switcher and the server-side
 * resolver both need this name, and anything pulling in `next/headers` here
 * would make the module unusable in a client component.
 */

/** Which clinic the switcher is pointed at. A preference, never a credential. */
export const SELECTED_CLINIC_COOKIE = "medcare.clinic";
