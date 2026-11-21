// Studio data shared by all pages. ES module bindings are read-only for importers, so
// updates go through the setters below.
export let state = null;
export let access = null;
export let creator = null;
export let engagement = null;
export let page = 'overview';

export function setStudioData(data) {
  ({ state, access, creator, engagement } = data);
}

export function setPage(id) {
  page = id;
}
