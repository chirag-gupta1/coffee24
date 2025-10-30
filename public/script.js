<script>
  const searchInput = document.getElementById('machineSearch');
  searchInput.addEventListener('input', () => {
    const term = searchInput.value.toLowerCase();
    document.querySelectorAll('.machine-card').forEach(card => {
      const code = card.dataset.code.toLowerCase();
      const loc = card.dataset.loc.toLowerCase();
      card.style.display = code.includes(term) || loc.includes(term) ? '' : 'none';
    });
  });
</script>
