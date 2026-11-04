// Public surface of src/host. Import from here, not from the files inside.
//
// src/host is the boundary between the game and the page it is embedded in:
// mounting into an element, taking itself back off again, pausing when nobody
// is looking, keeping the keyboard inside the container, and waiting for a real
// user gesture before it creates anything audio-shaped.
export { mount } from './mount';
export type { MountOptions, VigilGame } from './mount';
export { HOST_CONTEXT_KEY, readHostContext } from './hostContext';
export type { HostContext } from './hostContext';
