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

const appTarget = document.createElement('div');
appTarget.className = 'dartsnut-app';
document.body.appendChild(appTarget);

// `onVmInit` is a documented GUI prop: containers/gui.jsx calls it on mount with
// the VM it is about to render. That is the seam this bridge uses, so it never
// has to walk webpack internals to find the VM.
let vm = null;

const onVmInit = initializedVm => {
    vm = initializedVm;
    post({kind: 'editor-ready'});
};

const loadProject = async (message) => {
    if (!vm) {
        post({kind: 'editor-error', reason: 'bridge-failed', detail: 'the VM is not ready'});
        return;
    }
    try {
        await vm.loadProject(message.bytes);
        post({kind: 'project-loaded', project: message.project});
    } catch (error) {
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
        saveProject();
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
