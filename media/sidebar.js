(() => {
  const vscode = acquireVsCodeApi();
  const byId = id => document.getElementById(id);
  let pending = false;
  const result = (text, error = false) => {
    byId('result').textContent = text;
    byId('result').classList.toggle('error', error);
  };
  const lock = value => {
    pending = value;
    byId('fields').disabled = value;
    byId('scope').disabled = value;
    byId('check').disabled = value;
  };
  window.addEventListener('message', event => {
    const state = event.data;
    if (state.type === 'state') {
      const scope = byId('scope');
      scope.replaceChildren();
      for (const item of [{ label: 'Usuário (todos os projetos)', value: 'global' }, ...state.folders]) {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        scope.appendChild(option);
      }
      scope.value = state.scope;
      byId('model').value = state.model;
      byId('language').value = state.language;
      byId('extra').value = state.extraInstructions.join('\n');
      byId('activity').textContent = state.busy ? 'Geração em andamento. Cancele pelo botão Parar no painel Git.' : '';
      lock(false);
      result('');
    } else if (state.type === 'result') {
      lock(false);
      result(state.text, state.error);
    } else if (state.type === 'busy') {
      byId('activity').textContent = state.busy ? 'Geração em andamento. Cancele pelo botão Parar no painel Git.' : '';
    }
  });
  byId('scope').addEventListener('change', () => {
    const scope = byId('scope').value;
    lock(true);
    result('Carregando configurações…');
    vscode.postMessage({ type: 'load', scope });
  });
  byId('settings').addEventListener('submit', event => {
    event.preventDefault();
    if (pending) return;
    const message = { type: 'save', scope: byId('scope').value, model: byId('model').value, language: byId('language').value, extraInstructions: byId('extra').value };
    lock(true);
    result('Salvando…');
    vscode.postMessage(message);
  });
  byId('check').addEventListener('click', () => {
    const scope = byId('scope').value;
    lock(true);
    result('Verificando CLI instalado…');
    vscode.postMessage({ type: 'check', scope });
  });
  byId('advanced').addEventListener('click', () => vscode.postMessage({ type: 'advanced' }));
  vscode.postMessage({ type: 'ready' });
})();
