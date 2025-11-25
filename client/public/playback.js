(function(){
  const BTN_ID = 'listRecordings';
  const CONTAINER_ID = 'recordings';
  const SESSION_INPUT_ID = 'sessionid';
  const BASE = 'http://localhost:9996';

  const listBtn = document.getElementById(BTN_ID);
  const container = document.getElementById(CONTAINER_ID);
  const sessionInput = document.getElementById(SESSION_INPUT_ID);

  function buildGetUrl(path, start, duration) {
    // Ensure proper URL-encoding of query params and include format=mp4
    const url = new URL('/get', BASE);
    url.searchParams.set('path', path);
    url.searchParams.set('start', start);
    url.searchParams.set('duration', String(duration));
    url.searchParams.set('format', 'mp4');
    return url.toString();
  }

  function renderList(items, path) {
    container.innerHTML = '';

    if (!Array.isArray(items) || items.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'No hay grabaciones para "' + path + '"';
      container.appendChild(p);
      return;
    }

    const list = document.createElement('div');
    list.style.display = 'grid';
    list.style.gridTemplateColumns = 'repeat(auto-fill, minmax(320px, 1fr))';
    list.style.gap = '12px';

    items.forEach((it, idx) => {
      const card = document.createElement('div');
      card.style.border = '1px solid #ddd';
      card.style.borderRadius = '6px';
      card.style.padding = '8px';

      const title = document.createElement('div');
      title.style.fontWeight = '600';
      title.style.marginBottom = '6px';
      title.textContent = `#${idx+1} • inicio: ${it.start} • duración: ${it.duration}s`;

      const video = document.createElement('video');
      video.controls = true;
      video.width = 320;
      video.height = 180;
      const src = document.createElement('source');
      src.type = 'video/mp4';
      src.src = buildGetUrl(path, it.start, it.duration);
      video.appendChild(src);

      const link = document.createElement('a');
      link.href = src.src;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Abrir en pestaña';
      link.style.display = 'inline-block';
      link.style.marginTop = '6px';

      card.appendChild(title);
      card.appendChild(video);
      card.appendChild(link);
      list.appendChild(card);
    });

    container.appendChild(list);
  }

  async function listRecordings() {
    const path = (sessionInput.value || '').trim();
    if (!path) {
      alert('Ingrese el ID de sesión');
      return;
    }
    container.innerHTML = 'Cargando...';
    try {
      const url = new URL('/list', BASE);
      url.searchParams.set('path', path);
      const resp = await fetch(url.toString());
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      renderList(data, path);
    } catch (err) {
      container.innerHTML = '';
      const p = document.createElement('p');
      p.textContent = 'Error cargando lista: ' + (err && err.message ? err.message : String(err));
      container.appendChild(p);
    }
  }

  if (listBtn) {
    listBtn.addEventListener('click', listRecordings);
  }
})();
