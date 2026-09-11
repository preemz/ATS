// Editor client for the careers page builder. Served at /careers-editor.js.
// Pure DOM construction (no innerHTML) so user data is never re-parsed as HTML.
export const EDITOR_JS = `
(function(){
  var state = JSON.parse(JSON.stringify(window.__careersConfig || {sections:[]}));
  var acc = document.getElementById('ed-accordions');
  var iframe = document.getElementById('ed-preview');
  var toastEl = document.getElementById('ed-toast');
  var saveBtn = document.getElementById('ed-save');
  var dirty = false, previewTimer = null, pickerEl = null;

  var PAGE_DEFAULTS = { backgroundColor: '#1f0021', textColor: '#fffdfe' };
  var PRESETS = ['#1f0021', '#ffffff', '#fffdfe', '#faf9f6', '#171717', '#6d28d9', '#2f5fde', '#e83c3c', '#d0c87c', '#0f766e'];

  function el(tag, attrs, children){
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs){
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.slice(0,2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'style') n.setAttribute('style', attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    (children||[]).forEach(function(c){ if (c) n.appendChild(c); });
    return n;
  }
  function icon(name){
    var paths = {
      chev: 'M6 9l6 6 6-6',
      grip: null,
      trash: 'M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'
    };
    var svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('width','16'); svg.setAttribute('height','16'); svg.setAttribute('viewBox','0 0 24 24');
    svg.setAttribute('fill','none'); svg.setAttribute('stroke','currentColor'); svg.setAttribute('stroke-width','2');
    svg.setAttribute('stroke-linecap','round'); svg.setAttribute('stroke-linejoin','round');
    if (name === 'grip'){
      [[9,12],[9,5],[9,19],[15,12],[15,5],[15,19]].forEach(function(p){
        var c = document.createElementNS('http://www.w3.org/2000/svg','circle');
        c.setAttribute('cx',p[0]); c.setAttribute('cy',p[1]); c.setAttribute('r','1'); svg.appendChild(c);
      });
    } else {
      var p = document.createElementNS('http://www.w3.org/2000/svg','path');
      p.setAttribute('d', paths[name] || ''); svg.appendChild(p);
    }
    return svg;
  }

  function touch(){
    dirty = true;
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, 400);
  }
  function refreshPreview(){
    fetch('/api/careers/preview', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(state)})
      .then(function(r){ return r.text(); })
      .then(function(html){ iframe.setAttribute('srcdoc', html); })
      .catch(function(){});
  }

  function toast(msg){
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(function(){ toastEl.classList.remove('show'); }, 2200);
  }

  // ---------- field builders ----------
  function fldText(label, value, onChange, opts){
    opts = opts || {};
    var input = opts.textarea
      ? el('textarea', {placeholder: opts.placeholder || ''})
      : el('input', {type: opts.type || 'text', placeholder: opts.placeholder || ''});
    input.value = value || '';
    input.addEventListener('input', function(){ onChange(input.value); });
    return el('div', {class:'fld'}, [el('label',{text:label}), input, opts.hint ? el('div',{class:'hint',text:opts.hint}) : null]);
  }

  function colorRow(obj, key, def, label){
    var current = obj[key] || def;
    var swatch = el('button', {class:'swatch', type:'button', title:'Choose color'});
    swatch.style.backgroundColor = current;
    var reset = el('button', {class:'resetic', type:'button', title:'Reset to default'}, [icon('trash')]);
    reset.addEventListener('click', function(ev){
      ev.stopPropagation();
      delete obj[key];
      swatch.style.backgroundColor = def;
      closePicker(); touch();
    });
    swatch.addEventListener('click', function(ev){
      ev.stopPropagation();
      openPicker(swatch, obj[key] || def, function(v){
        obj[key] = v;
        swatch.style.backgroundColor = v;
        touch();
      });
    });
    return el('div', {class:'colorrow'}, [el('label',{text:label}), el('div',{class:'colorctl'}, [reset, swatch])]);
  }

  function openPicker(anchor, initial, onChange){
    closePicker();
    var colorIn = el('input', {type:'color'});
    colorIn.value = initial;
    var hexIn = el('input', {type:'text'});
    hexIn.value = initial;
    colorIn.addEventListener('input', function(){ hexIn.value = colorIn.value; onChange(colorIn.value); });
    hexIn.addEventListener('change', function(){
      var v = hexIn.value.trim().toLowerCase();
      if (/^#[0-9a-f]{6}$/.test(v)){ colorIn.value = v; onChange(v); }
      else hexIn.value = colorIn.value;
    });
    var presets = el('div', {class:'presets'}, PRESETS.map(function(p){
      var b = el('button', {type:'button', title:p});
      b.style.backgroundColor = p;
      b.addEventListener('click', function(ev){ ev.stopPropagation(); colorIn.value = p; hexIn.value = p; onChange(p); });
      return b;
    }));
    var pop = el('div', {class:'picker'}, [colorIn, el('div',{class:'hexrow'},[hexIn]), presets]);
    document.body.appendChild(pop);
    var r = anchor.getBoundingClientRect();
    pop.style.top = Math.min(r.bottom + 6 + window.scrollY, window.innerHeight - 200 + window.scrollY) + 'px';
    pop.style.left = Math.max(8, r.left - 150) + 'px';
    pop.addEventListener('click', function(ev){ ev.stopPropagation(); });
    pickerEl = pop;
  }
  function closePicker(){ if (pickerEl){ pickerEl.remove(); pickerEl = null; } }
  document.addEventListener('click', closePicker);

  function fldRich(label, value, onChange){
    var area = el('div', {class:'rich', contenteditable:'true', 'data-placeholder':'Add description'});
    area.innerHTML = value || '';
    area.addEventListener('input', function(){ onChange(area.innerHTML); });
    function tool(labelText, cmd){
      var b = el('button', {type:'button', title:labelText, text:labelText});
      b.addEventListener('mousedown', function(ev){ ev.preventDefault(); });
      b.addEventListener('click', function(ev){ ev.preventDefault(); document.execCommand(cmd); area.focus(); onChange(area.innerHTML); });
      return b;
    }
    var tools = el('div', {class:'richtools'}, [
      tool('B','bold'), tool('I','italic'), tool('U','underline'), tool('\\u2022 List','insertUnorderedList')
    ]);
    return el('div', {class:'fld'}, [el('label',{text:label}), el('div',{class:'richwrap'},[tools, area])]);
  }

  // ---------- section card ----------
  function sectionTitle(s){
    if (s.type === 'hero') return 'Main section';
    if (s.type === 'openPositions') return 'Open positions section';
    if (s.type === 'text') return 'Text Section';
    if (s.type === 'values') return 'Our values';
    if (s.type === 'photoCollage') return 'Photo gallery';
    if (s.type === 'video') return 'Video';
    if (s.type === 'members') return 'Team members';
    return 'Section';
  }
  function sectionDesc(s){
    if (s.type === 'hero') return 'Introduce your company and motivate applicants.';
    if (s.type === 'openPositions') return 'Open positions at your company.';
    if (s.type === 'text') return 'Add a text section to your page';
    if (s.type === 'values') return 'Primary values of your company.';
    if (s.type === 'photoCollage') return 'Images that showcase your company.';
    if (s.type === 'video') return 'What it\\u2018s like working with you?';
    if (s.type === 'members') return 'Who is working with you?';
    return '';
  }

  function accCard(opts){
    var isOpen = !!opts.open;
    var card = el('div', {class:'acc' + (opts.shadow ? ' shadowcard' : '') + (isOpen ? ' open' : '')});
    var head = el('div', {class:'acc-head'});
    if (opts.dragIndex != null){
      var h = el('span', {class:'dragh', title:'Drag to reorder', draggable:'true'}, [icon('grip')]);
      h.addEventListener('dragstart', function(ev){
        ev.dataTransfer.setData('text/plain', String(opts.dragIndex));
        ev.dataTransfer.effectAllowed = 'move';
        card.classList.add('dragsrc');
      });
      h.addEventListener('dragend', function(){ card.classList.remove('dragsrc'); });
      head.appendChild(h);
    }
    head.appendChild(el('div', {class:'ttl'}, [el('h3',{text:opts.title}), el('p',{text:opts.desc})]));
    if (opts.onDelete){
      var menu = el('button', {class:'acc-menu', type:'button', title:'Open menu', text:'\\u22ef'});
      menu.addEventListener('click', function(ev){
        ev.stopPropagation();
        if (confirm('Delete this section?')) opts.onDelete();
      });
      head.appendChild(menu);
    }
    head.appendChild(el('span', {class:'chev'}, [icon('chev')]));
    head.addEventListener('click', function(){ card.classList.toggle('open'); });
    var body = el('div', {class:'acc-body'});
    (opts.fields || []).forEach(function(f){ body.appendChild(f); });
    card.appendChild(head); card.appendChild(body);
    if (opts.dropZone){
      card.addEventListener('dragover', function(ev){ ev.preventDefault(); card.style.boxShadow = '0 0 0 2px #6d8df0'; });
      card.addEventListener('dragleave', function(){ card.style.boxShadow = ''; });
      card.addEventListener('drop', function(ev){
        ev.preventDefault(); card.style.boxShadow = '';
        var from = Number(ev.dataTransfer.getData('text/plain'));
        if (isNaN(from) || from === opts.dragIndex) return;
        var sections = state.sections;
        // index into sections: hero/openPositions are also in sections; map card order == sections order minus colors card
        var moved = sections.splice(from, 1)[0];
        sections.splice(opts.dragIndex, 0, moved);
        touch(); render();
      });
    }
    return card;
  }

  // ---------- render ----------
  function render(){
    acc.textContent = '';
    // Colors card
    var colorsCard = accCard({ title:'Colors', desc:'Match the color palette to your brand.', open:false, shadow:false,
      fields: [
        colorRow(state, 'backgroundColor', PAGE_DEFAULTS.backgroundColor, 'Background Color'),
        colorRow(state, 'textColor', PAGE_DEFAULTS.textColor, 'Text Color'),
      ]});
    acc.appendChild(colorsCard);

    state.sections.forEach(function(s, i){
      var fields = [];
      if (s.type === 'hero'){
        s.data = s.data || {};
        fields.push(fldText('Heading', s.data.title, function(v){ s.data.title = v; touch(); }));
        fields.push(fldText('Description', s.data.description, function(v){ s.data.description = v; touch(); }, {textarea:true}));
        fields.push(fldText('Image', s.data.image, function(v){ s.data.image = v; touch(); }, {type:'url', hint:'Paste an image URL (optional).'}));
        fields.push(colorRow(s.data, 'backgroundColor', state.backgroundColor, 'Background'));
        fields.push(colorRow(s.data, 'primaryTextColor', state.textColor, 'Primary text'));
        fields.push(colorRow(s.data, 'secondaryTextColor', state.textColor, 'Secondary text'));
      } else if (s.type === 'openPositions'){
        s.data = s.data || {};
        fields.push(fldText('Heading', s.data.title, function(v){ s.data.title = v; touch(); }));
        fields.push(fldText('Description', s.data.description, function(v){ s.data.description = v; touch(); }, {textarea:true}));
        fields.push(colorRow(s.data, 'backgroundColor', state.backgroundColor, 'Background'));
        fields.push(colorRow(s.data, 'textColor', state.textColor, 'Text'));
      } else if (s.type === 'text'){
        s.data = s.data || {};
        fields.push(fldText('Heading', s.data.title, function(v){ s.data.title = v; touch(); }));
        fields.push(fldRich('Content', s.data.body, function(v){ s.data.body = v; touch(); }));
        fields.push(colorRow(s.data, 'backgroundColor', state.backgroundColor, 'Background'));
        fields.push(colorRow(s.data, 'textColor', state.textColor, 'Text'));
      } else if (s.type === 'values'){
        s.data = s.data || {}; s.data.values = s.data.values || [];
        fields.push(fldText('Heading', s.data.title, function(v){ s.data.title = v; touch(); }));
        s.data.values.forEach(function(val, vi){
          var item = el('div', {class:'listitem'}, [
            el('div', {class:'rowtop'}, [ rmBtn(function(){ s.data.values.splice(vi,1); touch(); render(); }) ]),
            fldText('Value', val.title, function(v){ val.title = v; touch(); }),
            fldText('Description', val.description, function(v){ val.description = v; touch(); }, {textarea:true}),
          ]);
          fields.push(item);
        });
        fields.push(addBtn('+ Add value', function(){ s.data.values.push({title:'',description:''}); touch(); render(); }));
        fields.push(colorRow(s.data, 'backgroundColor', state.backgroundColor, 'Background'));
        fields.push(colorRow(s.data, 'textColor', state.textColor, 'Text'));
      } else if (s.type === 'photoCollage'){
        s.data = s.data || {}; s.data.images = s.data.images || [];
        s.data.images.forEach(function(im, ii){
          var thumb = el('img');
          thumb.src = im.url || '';
          var inp = el('input', {type:'url', placeholder:'https://\\u2026'});
          inp.value = im.url || '';
          inp.addEventListener('input', function(){ im.url = inp.value; thumb.src = inp.value; touch(); });
          var row = el('div', {class:'listitem'}, [
            el('div', {class:'rowtop'}, [ rmBtn(function(){ s.data.images.splice(ii,1); touch(); render(); }) ]),
            el('div', {class:'imgrow'}, [thumb, inp])
          ]);
          fields.push(row);
        });
        fields.push(addBtn('+ Add image', function(){ s.data.images.push({id:'img' + Date.now(), url:''}); touch(); render(); }));
        fields.push(colorRow(s.data, 'backgroundColor', state.backgroundColor, 'Background'));
      } else if (s.type === 'video'){
        s.data = s.data || {};
        fields.push(fldText('YouTube URL', s.data.videoUrl, function(v){ s.data.videoUrl = v; touch(); }, {hint:'Paste a YouTube link \\u2014 the video appears on your page.'}));
        fields.push(colorRow(s.data, 'backgroundColor', state.backgroundColor, 'Background'));
      } else if (s.type === 'members'){
        s.data = s.data || {}; s.data.members = s.data.members || [];
        fields.push(fldText('Heading', s.data.title, function(v){ s.data.title = v; touch(); }));
        s.data.members.forEach(function(m, mi){
          var item = el('div', {class:'listitem'}, [
            el('div', {class:'rowtop'}, [ rmBtn(function(){ s.data.members.splice(mi,1); touch(); render(); }) ]),
            fldText('Name', m.name, function(v){ m.name = v; touch(); }),
            fldText('Job title', m.jobTitle, function(v){ m.jobTitle = v; touch(); }),
            fldText('Testimony', m.testimony, function(v){ m.testimony = v; touch(); }, {textarea:true}),
            fldText('Photo URL', m.avatarUrl, function(v){ m.avatarUrl = v; touch(); }, {type:'url'}),
          ]);
          fields.push(item);
        });
        fields.push(addBtn('+ Add more', function(){ s.data.members.push({name:'',jobTitle:'',testimony:'',avatarUrl:''}); touch(); render(); }));
        fields.push(colorRow(s.data, 'backgroundColor', state.backgroundColor, 'Background'));
        fields.push(colorRow(s.data, 'textColor', state.textColor, 'Text'));
      }
      acc.appendChild(accCard({
        title: sectionTitle(s), desc: sectionDesc(s), shadow:true, open:false,
        dragIndex: i,
        onDelete: (s.type === 'hero' || s.type === 'openPositions') ? null : function(){
          state.sections.splice(i, 1); touch(); render();
        },
        dropZone: true,
        fields: fields,
      }));
    });
  }

  function rmBtn(fn){
    var b = el('button', {class:'rm', type:'button', title:'Remove'}, [icon('trash')]);
    b.addEventListener('click', function(ev){ ev.stopPropagation(); fn(); });
    return b;
  }
  function addBtn(label, fn){
    var b = el('button', {class:'additem', type:'button', text:label});
    b.addEventListener('click', function(ev){ ev.stopPropagation(); fn(); });
    return b;
  }

  // ---------- add block menu ----------
  var addBtnEl = document.getElementById('ed-addblock');
  var addMenu = document.getElementById('ed-addmenu');
  addBtnEl.addEventListener('click', function(ev){ ev.stopPropagation(); addMenu.hidden = !addMenu.hidden; });
  addMenu.addEventListener('click', function(ev){ ev.stopPropagation(); });
  document.addEventListener('click', function(){ addMenu.hidden = true; });
  Array.prototype.forEach.call(addMenu.querySelectorAll('button'), function(b){
    b.addEventListener('click', function(){
      var type = b.dataset.add;
      var defaults = {
        text: {title:'', body:''},
        values: {title:'', values:[{title:'',description:''}]},
        photoCollage: {description:'', images:[{id:'img' + Date.now(), url:''}]},
        video: {videoUrl:''},
        members: {title:'', members:[{name:'',jobTitle:'',testimony:'',avatarUrl:''}]},
      };
      state.sections.push({ id:'s' + Date.now(), type: type, data: defaults[type] });
      addMenu.hidden = true;
      touch(); render();
      var cards = acc.querySelectorAll('.acc.shadowcard');
      if (cards.length) cards[cards.length - 1].classList.add('open');
    });
  });

  // ---------- save ----------
  saveBtn.addEventListener('click', function(){
    saveBtn.disabled = true;
    fetch('/api/careers', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(state)})
      .then(function(r){ return r.json(); })
      .then(function(res){
        saveBtn.disabled = false;
        if (res && res.ok){ dirty = false; toast('Changes saved!'); }
        else toast('Failed to save changes');
      })
      .catch(function(){ saveBtn.disabled = false; toast('Failed to save changes'); });
  });

  window.addEventListener('beforeunload', function(ev){
    if (!dirty) return;
    ev.preventDefault();
    ev.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
    return ev.returnValue;
  });

  render();
  refreshPreview();
})();
`;
