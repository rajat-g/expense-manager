// Utility functions used across the application

// DOM selectors
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

// Date utilities
const todayISO = () => new Date().toISOString().slice(0,10);

// ID generation
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : ('id-'+Date.now()+'-'+Math.random().toString(36).slice(2,9)));

// Formatting
const fmt = n => '₹'+ (Number(n||0)).toLocaleString(undefined,{maximumFractionDigits:2});

// HTML escaping
const esc = s => (s??'').toString().replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));

// Fill select dropdown
function fillSelect(sel, rows, valueKey, labelKey){
  sel.innerHTML = rows.map(r=>`<option value="${esc(r[valueKey])}">${esc(r[labelKey])}</option>`).join("");
}

// Download blob as file
function downloadBlob(blob, filename){
  const url=URL.createObjectURL(blob); 
  const a=document.createElement("a");
  a.href=url; 
  a.download=filename; 
  document.body.appendChild(a); 
  a.click(); 
  a.remove(); 
  URL.revokeObjectURL(url);
}

// Date offset helper for sample data
const off = n => { 
  const d=new Date(); 
  d.setDate(d.getDate()+n); 
  return d.toISOString().slice(0,10); 
};
