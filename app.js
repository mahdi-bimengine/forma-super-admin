const NAV_ITEMS = [
  // { id: 'example', label: 'Example Section' },
];

function renderSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.innerHTML = NAV_ITEMS.map(item => `
    <button
      onclick="navigate('${item.id}')"
      id="nav-${item.id}"
      class="text-left px-3 py-2 rounded text-sm text-gray-400 hover:bg-gray-800 hover:text-gray-100 transition-colors w-full"
    >
      ${item.label}
    </button>
  `).join('');
}

function navigate(id) {
  document.querySelectorAll('#sidebar button').forEach(btn => {
    btn.classList.remove('bg-gray-800', 'text-gray-100');
    btn.classList.add('text-gray-400');
  });
  const active = document.getElementById(`nav-${id}`);
  if (active) {
    active.classList.add('bg-gray-800', 'text-gray-100');
    active.classList.remove('text-gray-400');
  }
  renderSection(id);
}

function renderSection(id) {
  const main = document.getElementById('main-content');
  main.innerHTML = `<div class="text-gray-500 text-sm">Section "${id}" not yet implemented.</div>`;
}

renderSidebar();
