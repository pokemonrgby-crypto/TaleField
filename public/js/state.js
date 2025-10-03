// /public/js/state.js
const listeners = new Map(); // event -> Set<fn>

export const state = {
  user: null,
  roomId: null,
  selected: new Set(), // 카드 선택
};

export function on(event, fn){ 
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
}
export function off(event, fn){
  listeners.get(event)?.delete(fn);
}
export function emit(event, payload){
  listeners.get(event)?.forEach(fn => fn(payload));
}

export function setUser(u){ state.user = u; emit("user", u); }
export function setRoom(id){ state.roomId = id; emit("room", id); }
export function setSelected(ids){ state.selected = new Set(ids); emit("selected", state.selected); }
export function addSelected(id){ state.selected.add(id); emit("selected", state.selected); }
export function removeSelected(id){ state.selected.delete(id); emit("selected", state.selected); }
