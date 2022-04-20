const testRows = document.querySelectorAll('tbody tr');
const button = /** @type {HTMLButtonElement} */ (document.getElementById('start'));
const preamble = /** @type {HTMLButtonElement} */ (document.getElementById('preamble'));
const error = document.getElementById('error');

const worker = new Worker('./opfs-worker.js', { type: "module" });
worker.addEventListener('message', function() {
  button.disabled = false;
}, { once: true });

button.addEventListener('click', async function() {
  button.disabled = true;
  preamble.disabled = true;
  error.textContent = '';

  // Clear previous results.
  for (const row of testRows) {
    while (row.childElementCount > 1) {
      row.removeChild(row.lastChild);
    }
  }

  try {
    const rows = Array.from(testRows);
    for await (const result of benchmark()) {
      const td = document.createElement('td');
      td.textContent = `${result / 1000} s`;
      rows.shift().append(td);
    }
  } finally {
    button.disabled = false;
    preamble.disabled = false;
  }
});

async function* benchmark() {
  await request({
    f: 'initialize',
    preamble: preamble.value
  });
  
  for (let i = 0; i < testRows.length; ++i) {
    const result = await request({ f: 'test', i });
    yield result;
  }

  await request({ f: 'finalize' });
}

function request(message) {
  worker.postMessage(message);
  return new Promise(function(resolve) {
    worker.addEventListener('message', function({ data }) {
      resolve(data);
    }, { once: true });
  });
}