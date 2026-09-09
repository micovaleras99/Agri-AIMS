// ============================================================
// location-select.js — cascading Region → Province → Municipality → Barangay
// Reads /api/locations/*. Used by the application form and the registration form.
// ============================================================

(function () {
  const LEVELS = ['region', 'province', 'municipality', 'barangay'];

  function endpointFor(level, parentId) {
    switch (level) {
      case 'region':       return '/api/locations/regions';
      case 'province':     return `/api/locations/regions/${parentId}/provinces`;
      case 'municipality': return `/api/locations/provinces/${parentId}/municipalities`;
      case 'barangay':     return `/api/locations/municipalities/${parentId}/barangays`;
      default:             return null;
    }
  }

  function labelFor(level) {
    return level === 'municipality' ? 'municipality or city' : level;
  }

  async function fetchOptions(level, parentId) {
    const res = await fetch(endpointFor(level, parentId), { credentials: 'same-origin' });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Could not load locations');
    return json.data;
  }

  /**
   * @param {object} opts
   * @param {string} opts.prefix   id prefix shared by the four selects
   * @param {object} [opts.selected] pre-selected ids, e.g. { regionId, provinceId, municipalityId, barangayId }
   */
  window.initLocationSelect = function initLocationSelect(opts) {
    const prefix = opts.prefix;
    const selected = opts.selected || {};

    const el = {};
    for (const level of LEVELS) {
      el[level] = document.getElementById(prefix + level.charAt(0).toUpperCase() + level.slice(1));
    }
    if (!el.region) return; // the form is not on this page

    const hidden = {
      region: document.getElementById(prefix + 'RegionName'),
      province: document.getElementById(prefix + 'ProvinceName'),
      municipality: document.getElementById(prefix + 'MunicipalityName'),
    };

    function reset(level, message) {
      const select = el[level];
      if (!select) return;
      select.innerHTML = `<option value="">${message}</option>`;
      select.disabled = true;
      if (hidden[level]) hidden[level].value = '';
    }

    function syncHiddenName(level) {
      if (!hidden[level] || !el[level]) return;
      const opt = el[level].selectedOptions[0];
      hidden[level].value = opt && opt.value ? opt.textContent.trim() : '';
    }

    async function load(level, parentId, preselectId) {
      const select = el[level];
      if (!select) return;
      select.disabled = true;
      select.innerHTML = `<option value="">Loading…</option>`;
      try {
        const rows = await fetchOptions(level, parentId);
        if (!rows.length) {
          select.innerHTML = `<option value="">No ${labelFor(level)} on file yet</option>`;
          return;
        }
        select.innerHTML =
          `<option value="">Select ${labelFor(level)}</option>` +
          rows.map((r) => `<option value="${r.id}">${r.name}</option>`).join('');
        select.disabled = false;
        if (preselectId) {
          select.value = String(preselectId);
          syncHiddenName(level);
          select.dispatchEvent(new Event('change', { bubbles: false }));
        }
      } catch (err) {
        select.innerHTML = `<option value="">Could not load ${labelFor(level)}</option>`;
        console.warn('location-select:', err.message);
      }
    }

    el.region.addEventListener('change', () => {
      syncHiddenName('region');
      reset('province', 'Select province');
      reset('municipality', 'Select municipality or city');
      reset('barangay', 'Select barangay');
      if (el.region.value) load('province', el.region.value);
    });

    el.province.addEventListener('change', () => {
      syncHiddenName('province');
      reset('municipality', 'Select municipality or city');
      reset('barangay', 'Select barangay');
      if (el.province.value) load('municipality', el.province.value);
    });

    el.municipality.addEventListener('change', () => {
      syncHiddenName('municipality');
      reset('barangay', 'Select barangay');
      if (el.municipality.value) load('barangay', el.municipality.value);
    });

    reset('province', 'Select region first');
    reset('municipality', 'Select province first');
    reset('barangay', 'Select municipality first');

    // Walking the chain with the saved ids re-selects each level in turn.
    load('region', null, selected.regionId).then(() => {
      if (!selected.regionId) return;
      return load('province', selected.regionId, selected.provinceId);
    }).then(() => {
      if (!selected.provinceId) return;
      return load('municipality', selected.provinceId, selected.municipalityId);
    }).then(() => {
      if (!selected.municipalityId) return;
      return load('barangay', selected.municipalityId, selected.barangayId);
    });
  };
})();
