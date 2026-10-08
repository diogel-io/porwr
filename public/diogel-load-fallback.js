window.setTimeout(() => {
  const entry = document.getElementById('q-app') || document.body;
  if (entry.innerHTML.trim() === '' || entry.innerHTML.includes('quasar:entry-point')) {
    console.error('App failed to mount within 10 seconds. Check console for errors.');

    const container = document.createElement('div');
    container.style.padding = '20px';
    container.style.color = 'black';
    container.style.background = 'white';
    container.style.position = 'fixed';
    container.style.top = '0';
    container.style.left = '0';
    container.style.width = '100%';
    container.style.zIndex = '9999';

    const title = document.createElement('h3');
    title.textContent = 'Failed to load Porwr';

    const message = document.createElement('p');
    message.textContent = 'Please check the background script logs or extension console for errors.';

    container.append(title, message);
    document.body.appendChild(container);
  }
}, 10000);
