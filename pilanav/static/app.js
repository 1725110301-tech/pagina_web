(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  let estado = { actual: null, total: 0, vacio: true, historial: [] };
  let vista = 'inicio';
  let resultado = null;
  let confirmando = false;
  let confirmTimer = null;
  let ocupado = false;

  /* ---------- API ---------- */
  async function api(metodo, ruta, cuerpo) {
    try {
      const res = await fetch(ruta, {
        method: metodo,
        headers: { 'Content-Type': 'application/json' },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({ ok: false, message: 'Respuesta inválida del servidor.' }));
      if (data && data.estado) estado = data.estado;
      return data;
    } catch (e) {
      return { ok: false, message: 'No se pudo conectar con el servidor.' };
    }
  }

  function partes(url) {
    try {
      const u = new URL(url);
      const rest = u.pathname === '/' && !u.search && !u.hash ? '' : u.pathname + u.search + u.hash;
      return { host: u.host, rest };
    } catch (e) {
      return { host: url, rest: '' };
    }
  }

  const plural = (n) => `${n} ${n === 1 ? 'página' : 'páginas'}`;

  /* ---------- Toast ---------- */
  let toastTimer = null;
  function toast(msg, malo = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('bad', malo);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ---------- Render: barra y pila ---------- */
  function renderBarra() {
    const u = $('#bar-url');
    u.textContent = estado.actual || 'about:blank';
    u.classList.toggle('empty', !estado.actual);
    $('#bar-count').textContent = plural(estado.total);
    $('#bar-back').disabled = estado.total < 2;
  }

  function renderPila(animarNuevo = false) {
    const ul = $('#stack');
    ul.replaceChildren();
    $('#stack-empty').hidden = !estado.vacio;
    const n = estado.historial.length;
    estado.historial.forEach((url, i) => {
      const li = el('li', 'item' + (i === 0 ? ' top' : ''));
      if (i === 0 && animarNuevo) li.classList.add('enter');
      const pos = el('span', 'pos', String(n - i));
      const body = el('div', 'body');
      const p = partes(url);
      body.append(el('strong', 'host', p.host));
      if (p.rest) body.append(el('span', 'rest', p.rest));
      li.append(pos, body);
      if (i === 0) li.append(el('span', 'flag', 'Sale primero'));
      ul.append(li);
    });
    ul.scrollTop = 0;
  }

  function renderTodo(animarNuevo = false) {
    renderBarra();
    renderPila(animarNuevo);
  }

  /* ---------- Render: consola ---------- */
  function setTitulo(t) { $('#console-title').textContent = t; }

  function renderConsola() {
    const body = $('#console-body');
    body.replaceChildren();
    clearTimeout(confirmTimer);

    if (vista === 'inicio') {
      setTitulo('Resultado');
      body.append(
        el('h3', null, 'Elige una opción'),
        el('p', 'muted', 'Usa el menú o presiona una tecla del 1 al 6.'),
        el('p', 'muted', 'El historial funciona como una pila: la última página que visitas queda arriba y es la primera que sale al regresar.')
      );
      return;
    }

    if (vista === 'visitar') {
      setTitulo('Visitar una página web');
      const form = el('form');
      form.noValidate = true;
      const field = el('div', 'field');
      const label = el('label', null, 'Dirección');
      label.htmlFor = 'url';
      const row = el('div', 'row');
      const input = el('input', 'input');
      input.id = 'url';
      input.type = 'text';
      input.placeholder = 'ejemplo.com/ruta';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.maxLength = 2048;
      input.setAttribute('autocapitalize', 'off');
      const btn = el('button', 'btn', 'Visitar');
      btn.type = 'submit';
      row.append(input, btn);
      const err = el('p', 'error');
      err.id = 'form-error';
      err.setAttribute('role', 'alert');
      field.append(label, row, err);
      form.append(field, el('p', 'note', 'Si no escribes http:// o https://, se usa https://.'));
      body.append(form);

      if (resultado && resultado.vista === 'visitar') {
        const r = el('p', 'result-line');
        r.append(el('b', null, 'Registrada: '), document.createTextNode(resultado.url));
        body.append(r);
      }

      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (ocupado) return;
        ocupado = true;
        btn.disabled = true;
        const r = await api('POST', '/api/visitar', { url: input.value });
        ocupado = false;
        btn.disabled = false;
        if (r.ok) {
          renderTodo(true);
          toast('Página registrada');
          resultado = { vista: 'visitar', url: r.pagina };
          renderConsola();
          const nuevo = $('#url');
          if (nuevo) nuevo.focus();
        } else {
          renderTodo(false);
          err.textContent = r.message || 'No se pudo registrar la página.';
          input.focus();
        }
      });
      return;
    }

    if (vista === 'actual') {
      setTitulo('Página actual');
      if (!estado.actual) {
        body.append(
          el('h3', null, 'No hay página actual'),
          el('p', 'muted', 'El historial está vacío. Usa la opción 1 para visitar una página.')
        );
        return;
      }
      const p = partes(estado.actual);
      body.append(
        el('p', 'muted', 'Estás en'),
        el('div', 'big-url', p.host),
        el('p', 'full-url', estado.actual)
      );
      return;
    }

    if (vista === 'historial') {
      setTitulo('Historial');
      if (estado.vacio) {
        body.append(
          el('h3', null, 'Historial vacío'),
          el('p', 'muted', 'Aún no visitas ninguna página. Usa la opción 1 para empezar.')
        );
        return;
      }
      body.append(
        el('h3', null, plural(estado.total)),
        el('p', 'muted', 'De la página actual a la primera que visitaste.')
      );
      const ol = el('ol', 'hist');
      const n = estado.historial.length;
      estado.historial.forEach((url, i) => {
        const li = el('li');
        li.append(el('span', 'n', String(i + 1)), el('span', 'u', url));
        if (i === 0) li.append(el('span', 'badge now', 'Actual'));
        else if (i === n - 1) li.append(el('span', 'badge', 'Primera'));
        ol.append(li);
      });
      body.append(ol);
      return;
    }

    if (vista === 'gestionar') {
      setTitulo('Verificar o eliminar historial');
      const st = el('span', 'status' + (estado.vacio ? '' : ' full'), estado.vacio ? 'Vacío' : plural(estado.total));
      body.append(st);
      body.append(el('h3', null, estado.vacio ? 'El historial está vacío' : 'El historial tiene páginas'));
      body.append(
        el('p', 'muted', estado.vacio
          ? 'No hay nada que eliminar. Visita una página con la opción 1.'
          : 'Si lo eliminas, se borran todas las páginas y no se pueden recuperar.')
      );
      const btn = el('button', 'btn danger', confirmando ? 'Confirmar: eliminar todo' : 'Eliminar historial');
      btn.type = 'button';
      btn.disabled = estado.vacio;
      btn.addEventListener('click', async () => {
        if (ocupado) return;
        if (!confirmando) {
          confirmando = true;
          btn.textContent = 'Confirmar: eliminar todo';
          confirmTimer = setTimeout(() => {
            confirmando = false;
            btn.textContent = 'Eliminar historial';
          }, 4000);
          return;
        }
        clearTimeout(confirmTimer);
        confirmando = false;
        ocupado = true;
        const r = await api('POST', '/api/limpiar');
        ocupado = false;
        renderTodo(false);
        toast(r.ok ? 'Historial eliminado' : (r.message || 'No se pudo eliminar'), !r.ok);
        renderConsola();
      });
      body.append(btn);
      return;
    }

    if (vista === 'resultado' && resultado) {
      setTitulo('Regresar a la página anterior');
      const card = el('div', 'tone-' + resultado.tono);
      card.append(el('h3', null, resultado.titulo));
      resultado.lineas.forEach(([k, v]) => {
        const p = el('p', 'result-line');
        if (k) p.append(el('b', null, k + ' '));
        p.append(document.createTextNode(v));
        card.append(p);
      });
      body.append(card);
    }
  }

  /* ---------- Menú ---------- */
  function marcarActivo(n) {
    $$('.cmd').forEach((b) => {
      const on = b.dataset.cmd === String(n);
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    });
  }

  async function sincronizar() {
    await api('GET', '/api/estado');
    renderTodo(false);
  }

  async function regresar() {
    ocupado = true;
    const r = await api('POST', '/api/regresar');
    if (r.ok) {
      const top = $('#stack .item.top');
      if (top) {
        top.classList.add('leave');
        await sleep(230);
      }
    }
    renderTodo(false);
    vista = 'resultado';
    resultado = r.ok
      ? { tono: 'ok', titulo: 'Regresaste', lineas: [['Saliste de:', r.salio], ['Ahora estás en:', estado.actual || '']] }
      : { tono: 'warn', titulo: 'No se pudo regresar', lineas: [['', r.message || 'Ocurrió un error.']] };
    renderConsola();
    toast(r.ok ? 'Regresaste a la página anterior' : (r.message || 'No se pudo regresar'), !r.ok);
    ocupado = false;
  }

  async function salir() {
    ocupado = true;
    const r = await api('POST', '/api/salir');
    ocupado = false;
    renderTodo(false);
    const n = r.descartadas || 0;
    $('#bye-text').textContent = n
      ? `Se descartaron ${plural(n)} del historial.`
      : 'El historial estaba vacío.';
    $('#bye').hidden = false;
    $('#bye-btn').focus();
  }

  async function elegir(n) {
    if (ocupado || !$('#bye').hidden) return;
    confirmando = false;
    marcarActivo(n);
    resultado = null;

    if (n === 1) {
      vista = 'visitar';
      renderConsola();
      const i = $('#url');
      if (i) i.focus();
    } else if (n === 2) {
      await regresar();
    } else if (n === 3) {
      await sincronizar();
      vista = 'actual';
      renderConsola();
    } else if (n === 4) {
      await sincronizar();
      vista = 'historial';
      renderConsola();
    } else if (n === 5) {
      await sincronizar();
      vista = 'gestionar';
      renderConsola();
    } else if (n === 6) {
      await salir();
    }
  }

  /* ---------- Eventos ---------- */
  $$('.cmd').forEach((b) => b.addEventListener('click', () => elegir(Number(b.dataset.cmd))));
  $('#bar-back').addEventListener('click', () => elegir(2));

  $('#bye-btn').addEventListener('click', () => {
    $('#bye').hidden = true;
    vista = 'inicio';
    resultado = null;
    marcarActivo(0);
    renderConsola();
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      if (ev.key === 'Escape') t.blur();
      return;
    }
    if (/^[1-6]$/.test(ev.key)) {
      ev.preventDefault();
      elegir(Number(ev.key));
    }
  });

  /* ---------- Inicio ---------- */
  (async () => {
    await sincronizar();
    renderConsola();
  })();
})();
