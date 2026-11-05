// Dartsnut bridge entrypoint for the vendored Scratch editor.
//
// This file is placed into the upstream checkout by the regeneration script and
// is not part of upstream. It composes the editor exactly the way upstream's own
// playground does, and adds one thing upstream's playground does not: a bridge
// the host can talk to.
//
// The host is a same-origin iframe parent. Everything crosses by postMessage;
// nothing here can reach the host's filesystem, because it holds no capability.

import React from 'react';
import ReactDOM from 'react-dom';
import {compose} from 'redux';

import AppStateHOC from './src/lib/app-state-hoc.jsx';
import GUI from './src/containers/gui.jsx';
import HashParserHOC from './src/lib/hash-parser-hoc.jsx';

const CHANNEL = 'dartsnut.scratch-editor';
const VERSION = 1;

const post = (message, transfer) => {
    window.parent.postMessage(
        Object.assign({channel: CHANNEL, version: VERSION}, message),
        '*',
        transfer || []
    );
};

const toBytes = async blob => {
    const buffer = await blob.arrayBuffer();
    return new Uint8Array(buffer);
};

// Autosave: a change is written shortly after the user stops making it. Long
// enough that dragging a block does not serialise the whole project per frame,
// short enough that closing the window does not lose the last edit.
const AUTOSAVE_DEBOUNCE_MS = 1000;

const appTarget = document.createElement('div');
appTarget.className = 'dartsnut-app';

// Holding the project during load would be indistinguishable from an edit, so
// autosave is suppressed until the load settles. Otherwise opening a project
// schedules a write of the bytes that were just read.
let loading = false;
let autosaveTimer = null;
let dirty = false;
document.body.appendChild(appTarget);

// `onVmInit` is a documented GUI prop: containers/gui.jsx calls it on mount with
// the VM it is about to render. That is the seam this bridge uses, so it never
// has to walk webpack internals to find the VM.
let vm = null;

const onVmInit = initializedVm => {
    vm = initializedVm;
    // The VM's own change signal is the only reliable one: watching the redux
    // store would miss block and costume edits made inside the VM.
    vm.runtime.on('PROJECT_CHANGED', () => {
        if (loading) return;
        dirty = true;
        scheduleAutosave();
    });
    post({kind: 'editor-ready'});
};

const scheduleAutosave = () => {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
        autosaveTimer = null;
        saveProject();
    }, AUTOSAVE_DEBOUNCE_MS);
};

/** Emit immediately, cancelling a pending autosave: used on flush. */
const flushAutosave = () => {
    if (autosaveTimer) {
        clearTimeout(autosaveTimer);
        autosaveTimer = null;
    }
    if (dirty) saveProject();
};

const loadProject = async (message) => {
    if (!vm) {
        post({kind: 'editor-error', reason: 'bridge-failed', detail: 'the VM is not ready'});
        return;
    }
    loading = true;
    dirty = false;
    try {
        await vm.loadProject(message.bytes);
        loading = false;
        post({kind: 'project-loaded', project: message.project});
    } catch (error) {
        loading = false;
        post({
            kind: 'editor-error',
            reason: 'project-load-failed',
            detail: String((error && error.message) || error)
        });
    }
};

const saveProject = async () => {
    if (!vm) return;
    try {
        const bytes = await toBytes(await vm.saveProjectSb3());
        dirty = false;
        // Project identity is echoed from the last load: the host owns identity,
        // and the editor must not invent one for a save it cannot attribute.
        post({kind: 'save-project', project: lastIdentity, bytes}, [bytes.buffer]);
    } catch (error) {
        post({
            kind: 'editor-error',
            reason: 'bridge-failed',
            detail: String((error && error.message) || error)
        });
    }
};

let lastIdentity = {projectId: '', fileName: ''};

window.addEventListener('message', event => {
    const data = event.data;
    if (!data || data.channel !== CHANNEL) return;
    if (data.version !== VERSION) {
        post({
            kind: 'editor-error',
            reason: 'protocol-mismatch',
            detail: `editor speaks ${VERSION}, host speaks ${String(data.version)}`
        });
        return;
    }
    if (data.kind === 'hello') {
        // The host announces itself first; answer only once the VM exists, or the
        // host would load into a VM that cannot accept it.
        if (vm) post({kind: 'editor-ready'});
        return;
    }
    if (data.kind === 'load-project') {
        lastIdentity = data.project;
        loadProject(data);
        return;
    }
    if (data.kind === 'request-save') {
        // The host flushes on project switch and on close; a debounced write that
        // never fires would lose the last edit.
        flushAutosave();
        return;
    }
    if (data.kind === 'flush') {
        flushAutosave();
    }
});

const WrappedGui = compose(
    AppStateHOC,
    HashParserHOC
)(GUI);

ReactDOM.render(
    <WrappedGui
        canEditTitle
        canSave={false}
        onVmInit={onVmInit}
    />,
    appTarget
);
