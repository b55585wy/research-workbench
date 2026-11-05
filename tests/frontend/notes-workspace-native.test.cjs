const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");
const { fixture, flatten } = require("./notes-workspace-dom.cjs");
let attach;
test.before(async () => {
  ({ attachNativeHost: attach } = await import(pathToFileURL(path.join(__dirname, "../../web/src/features/notes-workspace/native-host.ts"))));
});

test("native form/list/image node identities and editor bookmarks survive repeated presentation changes", () => {
  const f = fixture();
  const originalNodes = flatten(f.root).filter((node) => node.id);
  const editor = f.hosts.editor.children[1];
  const bookmark = editor.bookmark = { index: 17, length: 0 };
  let nativeSaves = 0;
  editor.save = () => { nativeSaves += 1; };
  const leases = Object.keys(f.hosts).map((section) => attach(f.hosts[section], f.slots[section]));
  for (const active of ["saved", "editor", "images", "editor", "saved"]) {
    for (const section of Object.keys(f.slots)) f.slots[section].hidden = section !== active;
    assert.equal(f.hosts.editor.children[1], editor);
    assert.equal(editor.bookmark, bookmark);
    for (const section of Object.keys(f.hosts)) assert.equal(f.slots[section].children[0], f.hosts[section]);
    const current = flatten(f.root).filter((node) => node.id);
    assert.equal(new Set(current.map((node) => node.id)).size, originalNodes.length);
    for (const node of originalNodes) assert.ok(current.includes(node));
  }
  assert.equal(nativeSaves, 0);
  editor.save();
  assert.equal(nativeSaves, 1);
  leases.forEach((lease) => lease.release());
});

test("destroy/remount restores exact parent order, literal hidden/open flags, summaries and existing classes", () => {
  const f = fixture();
  const order = [...f.parent.childNodes];
  f.hosts.editor.setAttribute("hidden", "until-found");
  f.hosts.editor.setAttribute("open", "open");
  f.hosts.editor.children[0].hidden = true;
  f.hosts.saved.classList.add("notes-workspace-native-host");
  for (let round = 0; round < 2; round += 1) {
    const leases = Object.keys(f.hosts).map((section) => attach(f.hosts[section], f.slots[section]));
    assert.equal(f.hosts.editor.hidden, false);
    assert.equal(f.hosts.editor.children[0].hidden, false);
    for (const host of Object.values(f.hosts)) {
      assert.equal(host.open, true);
      assert.equal(host.children[0].classList.contains("notes-workspace-native-summary"), true);
      host.open = false; // Native summary toggling remains available.
    }
    leases.reverse().forEach((lease) => { lease.release(); lease.release(); });
    assert.deepEqual(f.parent.childNodes, order);
    assert.equal(f.hosts.editor.getAttribute("hidden"), "until-found");
    assert.equal(f.hosts.editor.getAttribute("open"), "open");
    assert.equal(f.hosts.saved.getAttribute("open"), null);
    assert.equal(f.hosts.editor.children[0].hidden, true);
    assert.equal(f.hosts.editor.classList.contains("notes-workspace-native-host"), false);
    assert.equal(f.hosts.saved.classList.contains("notes-workspace-native-host"), true);
    assert.equal(flatten(f.root).filter((node) => node.tagName === "#COMMENT").length, 0);
  }
});

test("failed movement rolls back and allows a subsequent mount", () => {
  const f = fixture();
  const order = [...f.parent.childNodes];
  const append = f.slots.editor.append;
  f.slots.editor.append = () => { throw new Error("DOM move failed"); };
  assert.throws(() => attach(f.hosts.editor, f.slots.editor), /DOM move failed/);
  assert.deepEqual(f.parent.childNodes, order);
  assert.equal(f.hosts.editor.open, false);
  assert.equal(f.hosts.editor.children[0].classList.contains("notes-workspace-native-summary"), false);
  f.slots.editor.append = append;
  attach(f.hosts.editor, f.slots.editor).release();
  assert.deepEqual(f.parent.childNodes, order);
});

test("competing owners, occupied slots, nested slots and detached hosts fail without disturbing native controls", () => {
  const f = fixture();
  const lease = attach(f.hosts.editor, f.slots.editor);
  assert.throws(() => attach(f.hosts.editor, f.slots.saved), /unclaimed/);
  lease.release();
  f.slots.saved.append(f.make("button"));
  assert.throws(() => attach(f.hosts.saved, f.slots.saved), /empty slot/);
  assert.throws(() => attach(f.hosts.images, f.hosts.images.children[1]), /empty slot/);
  assert.throws(() => attach(f.make("details"), f.slots.images), /unclaimed/);
  assert.equal(f.hosts.saved.parentNode, f.parent);
  assert.equal(f.hosts.images.parentNode, f.parent);
});

test("removed anchors still restore using the original sibling fallback", () => {
  const f = fixture();
  const order = [...f.parent.childNodes];
  const lease = attach(f.hosts.editor, f.slots.editor);
  f.parent.childNodes.find((node) => node.tagName === "#COMMENT").remove();
  lease.release();
  assert.deepEqual(f.parent.childNodes, order);
});
