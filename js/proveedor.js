(function (raiz) {
  'use strict';

  /* ================================================================
     Proveedor de datos.

     Modo 'directo' (por defecto): el navegador descarga el .xlsx del
     mes con la API de Drive y lo procesa con SheetJS. No hay servicio
     intermediario ni credenciales privadas: solo una clave de API
     pública y restringida a lectura de archivos públicos.

     Modo 'appsscript': usa una implementación de Google Apps Script
     que devuelve JSON (JSONP), como respaldo.
     ================================================================ */

  var MAX_MESES_EN_MEMORIA = 3;
  var cacheMeses = {};
  var ordenMeses = [];
  var cacheIndice = null;
  var contadorCallback = 0;

  function config() {
    return raiz.CONFIG || {};
  }

  function claveApi() {
    return config().driveApiKey || '';
  }

  function carpetaId() {
    return config().carpetaId || '';
  }

  function numero(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    var n = typeof valor === 'number' ? valor : Number(String(valor).replace(',', '.'));
    return isFinite(n) ? n : null;
  }

  function dosDigitos(n) {
    return (n < 10 ? '0' : '') + n;
  }

  // SheetJS construye las fechas desde el serial del libro en UTC:
  // se leen con getUTC* para recuperar la hora de pared del archivo.
  function textoFecha(valor) {
    if (valor instanceof Date) {
      return valor.getUTCFullYear() + '-' + dosDigitos(valor.getUTCMonth() + 1) + '-' +
        dosDigitos(valor.getUTCDate()) + ' ' + dosDigitos(valor.getUTCHours()) + ':' +
        dosDigitos(valor.getUTCMinutes()) + ':' + dosDigitos(valor.getUTCSeconds());
    }
    return String(valor === null || valor === undefined ? '' : valor).trim().replace('T', ' ');
  }

  function ahora() {
    var d = new Date();
    return d.getFullYear() + '-' + dosDigitos(d.getMonth() + 1) + '-' + dosDigitos(d.getDate()) +
      ' ' + dosDigitos(d.getHours()) + ':' + dosDigitos(d.getMinutes()) + ':' + dosDigitos(d.getSeconds());
  }

  /* ----------------------------------------------------------------
     Índice de meses
     ---------------------------------------------------------------- */

  function normalizarMeses(archivos) {
    return archivos.map(function (f) {
      var nombre = f.name || f.archivo || '';
      var partes = /^(\d{4})-(\d{2})\.xlsx$/i.exec(nombre);
      if (!partes) return null;
      return {
        anio: Number(partes[1]),
        mes: Number(partes[2]),
        archivo: nombre,
        id: f.id,
        actualizado: f.modifiedTime ? f.modifiedTime.slice(0, 10) : ''
      };
    }).filter(Boolean).sort(function (a, b) {
      return a.anio - b.anio || a.mes - b.mes;
    });
  }

  function indiceLocal() {
    return fetch('datos/indice.json', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('No se pudo leer el índice local de meses.');
      return r.json();
    });
  }

  function indiceDrive() {
    if (cacheIndice) return Promise.resolve(cacheIndice);

    if (!claveApi()) {
      return Promise.reject(new Error('Falta configurar driveApiKey en js/config.js.'));
    }

    var consulta = "'" + carpetaId() + "' in parents and trashed = false";
    var url = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(consulta) +
      '&fields=' + encodeURIComponent('files(id,name,modifiedTime)') +
      '&pageSize=1000&orderBy=name&key=' + encodeURIComponent(claveApi());

    return fetch(url).then(function (r) {
      if (r.status === 400) {
        throw new Error('La clave de API no es válida (400). Revise driveApiKey en js/config.js.');
      }
      if (r.status === 403) {
        throw new Error('Drive rechazó la consulta (403). Revise que la API de Drive esté habilitada ' +
          'para esa clave y que la carpeta siga siendo pública.');
      }
      if (!r.ok) {
        // Problema de red o del servicio: se usa el índice local como respaldo.
        return indiceLocal().then(function (local) {
          local.origen = 'indice-local';
          cacheIndice = local;
          return local;
        });
      }
      return r.json().then(function (datos) {
        var meses = normalizarMeses(datos.files || []);
        if (!meses.length) throw new Error('La carpeta no devolvió archivos mensuales.');
        cacheIndice = { ok: true, carpeta: 'Reportes meteorologicos', meses: meses, origen: 'drive' };
        return cacheIndice;
      });
    });
  }

  /* ----------------------------------------------------------------
     Descarga y análisis del libro
     ---------------------------------------------------------------- */

  function leerLibro(buffer) {
    if (!raiz.XLSX) throw new Error('No se cargó SheetJS (vendor/xlsx.full.min.js).');
    return raiz.XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
  }

  // Convierte el libro completo en la lista de registros del mes.
  function construirMes(libro, archivo, archivoId) {
    var nombreHoja = libro.SheetNames[0];
    var hoja = libro.Sheets[nombreHoja];
    var filas = raiz.XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: null, blankrows: false });

    if (!filas.length) throw new Error('El archivo ' + archivo + ' está vacío.');

    var encabezados = filas[0].map(function (h) { return String(h).trim(); });
    var indiceColumna = {};
    encabezados.forEach(function (h, i) { indiceColumna[h.toLowerCase()] = i; });

    function col(nombre) {
      var i = indiceColumna[String(nombre).toLowerCase()];
      return i === undefined ? -1 : i;
    }

    var cFecha = col('dateTime');
    var cViento = col('windSpeed');
    var cRadiacion = col('radiation');
    var cTemperatura = col('outTemp');
    var cRacha = col('windGust');
    var cDireccion = col('windDir');
    var cIntervalo = col('interval');
    var cUnidades = col('usUnits');

    if (cFecha < 0 || cViento < 0 || cTemperatura < 0) {
      throw new Error('El archivo ' + archivo + ' no tiene las columnas dateTime, windSpeed y outTemp. ' +
        'Columnas encontradas: ' + encabezados.join(', '));
    }

    var registros = [];
    var conteoIntervalos = {};
    var usUnits = 16;

    for (var i = 1; i < filas.length; i++) {
      var fila = filas[i];
      if (!fila) continue;
      var t = textoFecha(fila[cFecha]);
      if (t.length < 16) continue;

      if (cIntervalo >= 0) {
        var intervalo = numero(fila[cIntervalo]);
        if (intervalo) conteoIntervalos[intervalo] = (conteoIntervalos[intervalo] || 0) + 1;
      }
      if (cUnidades >= 0) {
        var unidades = numero(fila[cUnidades]);
        if (unidades) usUnits = unidades;
      }

      registros.push({
        t: t,
        v: numero(fila[cViento]),
        r: cRadiacion >= 0 ? numero(fila[cRadiacion]) : null,
        temp: numero(fila[cTemperatura]),
        g: cRacha >= 0 ? numero(fila[cRacha]) : null,
        dir: cDireccion >= 0 ? numero(fila[cDireccion]) : null
      });
    }

    var intervaloReal = 0;
    var maximo = 0;
    Object.keys(conteoIntervalos).forEach(function (k) {
      if (conteoIntervalos[k] > maximo) {
        maximo = conteoIntervalos[k];
        intervaloReal = Number(k);
      }
    });

    return {
      archivo: archivo,
      archivoId: archivoId,
      hoja: nombreHoja,
      usUnits: usUnits,
      intervalo: intervaloReal || 5,
      totalFilasArchivo: registros.length,
      registros: registros
    };
  }

  function descargarMes(id) {
    var url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) +
      '?alt=media&key=' + encodeURIComponent(claveApi());
    return fetch(url).then(function (r) {
      if (r.status === 403) {
        throw new Error('Drive rechazó la descarga (403). Revise que la clave de API sea válida, ' +
          'que la API de Drive esté habilitada y que el archivo siga siendo público.');
      }
      if (r.status === 404) {
        throw new Error('El archivo del mes no existe o ya no es público (404).');
      }
      if (!r.ok) throw new Error('No se pudo descargar el archivo del mes (HTTP ' + r.status + ').');
      return r.arrayBuffer();
    }).then(leerLibro);
  }

  function cargarMes(mes) {
    if (cacheMeses[mes]) return Promise.resolve(cacheMeses[mes]);

    return indiceDrive().then(function (indice) {
      var encontrado = indice.meses.filter(function (m) { return m.anio + '-' + dosDigitos(m.mes) === mes; })[0];
      if (!encontrado) {
        var error = new Error('El repositorio no contiene el archivo ' + mes + '.xlsx');
        error.faltaArchivo = true;
        throw error;
      }
      return descargarMes(encontrado.id).then(function (libro) {
        var datos = construirMes(libro, encontrado.archivo, encontrado.id);
        cacheMeses[mes] = datos;
        ordenMeses.push(mes);
        while (ordenMeses.length > MAX_MESES_EN_MEMORIA) {
          delete cacheMeses[ordenMeses.shift()];
        }
        return datos;
      });
    });
  }

  /* ----------------------------------------------------------------
     Respuesta del día (misma forma en todos los modos)
     ---------------------------------------------------------------- */

  function respuestaDia(datos, fecha, origen) {
    var registros = datos.registros.filter(function (r) { return r.t.slice(0, 10) === fecha; });
    var sinDato = { viento: 0, radiacion: 0, temperatura: 0 };
    registros.forEach(function (r) {
      if (r.v === null) sinDato.viento++;
      if (r.r === null) sinDato.radiacion++;
      if (r.temp === null) sinDato.temperatura++;
    });

    return {
      ok: true,
      origen: origen,
      fecha: fecha,
      archivo: datos.archivo,
      archivoId: datos.archivoId,
      archivoUrl: datos.archivoUrl || ('https://drive.google.com/file/d/' + datos.archivoId + '/view'),
      hoja: datos.hoja,
      usUnits: datos.usUnits,
      intervalo: datos.intervalo,
      totalFilasArchivo: datos.totalFilasArchivo,
      registros: registros,
      sinDato: sinDato,
      generado: ahora()
    };
  }

  function diaDrive(fecha) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) {
      return Promise.resolve({ ok: false, error: 'Fecha inválida. Use AAAA-MM-DD.' });
    }
    var mes = fecha.slice(0, 7);
    return cargarMes(mes).then(function (datos) {
      return respuestaDia(datos, fecha, 'drive');
    });
  }

  /* ----------------------------------------------------------------
     JSON publicados (GitHub Pages, raw.githubusercontent, jsDelivr)
     ---------------------------------------------------------------- */

  function baseDatos() {
    var base = config().baseDatos || 'datos/';
    return base.charAt(base.length - 1) === '/' ? base : base + '/';
  }

  function indiceEstatico() {
    if (cacheIndice) return Promise.resolve(cacheIndice);

    return fetch(baseDatos() + 'indice.json', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) {
        throw new Error('No se pudo leer el índice publicado (HTTP ' + r.status + '). ' +
          'Revise la dirección baseDatos en js/config.js.');
      }
      return r.json();
    }).then(function (datos) {
      var meses = (datos.meses || []).map(function (m) {
        return {
          anio: m.anio,
          mes: m.mes,
          archivo: m.archivo,
          id: m.archivoId,
          filas: m.filas,
          intervalo: m.intervalo
        };
      });
      if (!meses.length) throw new Error('El índice publicado no contiene meses.');
      cacheIndice = {
        ok: true,
        carpeta: datos.carpeta || 'Reportes meteorologicos',
        meses: meses,
        origen: 'json-publicado'
      };
      return cacheIndice;
    });
  }

  function cargarMesEstatico(mes) {
    if (cacheMeses[mes]) return Promise.resolve(cacheMeses[mes]);

    return fetch(baseDatos() + mes + '.json', { cache: 'no-store' }).then(function (r) {
      if (r.status === 404) {
        var error = new Error('El repositorio no contiene el archivo ' + mes + '.xlsx');
        error.faltaArchivo = true;
        throw error;
      }
      if (!r.ok) throw new Error('No se pudo descargar ' + mes + '.json (HTTP ' + r.status + ').');
      return r.json();
    }).then(function (datos) {
      cacheMeses[mes] = datos;
      ordenMeses.push(mes);
      while (ordenMeses.length > MAX_MESES_EN_MEMORIA) {
        delete cacheMeses[ordenMeses.shift()];
      }
      return datos;
    });
  }

  function diaEstatico(fecha) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) {
      return Promise.resolve({ ok: false, error: 'Fecha inválida. Use AAAA-MM-DD.' });
    }
    var mes = fecha.slice(0, 7);
    return cargarMesEstatico(mes).then(function (datos) {
      return respuestaDia(datos, fecha, 'json-publicado');
    });
  }

  /* ----------------------------------------------------------------
     Respaldo: Apps Script (JSONP)
     ---------------------------------------------------------------- */

  function construirUrl(parametros) {
    var partes = [];
    Object.keys(parametros).forEach(function (clave) {
      partes.push(encodeURIComponent(clave) + '=' + encodeURIComponent(parametros[clave]));
    });
    return config().endpoint + '?' + partes.join('&');
  }

  function jsonp(parametros, tiempoEspera) {
    return new Promise(function (resolver, rechazar) {
      var nombre = '__urbe_cb_' + (++contadorCallback);
      var script = document.createElement('script');
      var terminado = false;

      var temporizador = setTimeout(function () {
        finalizar();
        rechazar(new Error('La consulta tardó demasiado. La primera vez que se abre un mes, ' +
          'el servicio debe convertir el Excel y puede tardar hasta un minuto.'));
      }, tiempoEspera || 180000);

      raiz[nombre] = function (datos) {
        finalizar();
        resolver(datos);
      };

      function finalizar() {
        if (terminado) return;
        terminado = true;
        clearTimeout(temporizador);
        raiz[nombre] = function () {};
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      script.onerror = function () {
        finalizar();
        rechazar(new Error('No se pudo conectar con el servicio de Apps Script.'));
      };

      var conCallback = {};
      Object.keys(parametros).forEach(function (k) { conCallback[k] = parametros[k]; });
      conCallback.callback = nombre;

      script.src = construirUrl(conCallback);
      document.head.appendChild(script);
    });
  }

  function indiceAppsScript() {
    return jsonp({ action: 'indice' }, 45000).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || 'Respuesta inválida del servicio.');
      r.origen = 'appsscript';
      return r;
    });
  }

  function diaAppsScript(fecha) {
    return jsonp({ action: 'dia', fecha: fecha }).then(function (r) {
      if (!r) throw new Error('El servicio no devolvió datos.');
      r.origen = 'appsscript';
      return r;
    });
  }

  /* ---------------------------------------------------------------- */

  raiz.Proveedor = {
    modo: function () { return config().modo || 'estatico'; },
    indice: function () {
      var modo = raiz.Proveedor.modo();
      if (modo === 'appsscript') return indiceAppsScript();
      if (modo === 'directo') return indiceDrive();
      return indiceEstatico();
    },
    dia: function (fecha) {
      var modo = raiz.Proveedor.modo();
      if (modo === 'appsscript') return diaAppsScript(fecha);
      if (modo === 'directo') return diaDrive(fecha);
      return diaEstatico(fecha);
    },
    // expuesto para pruebas automatizadas
    _construirMes: construirMes,
    _leerLibro: leerLibro,
    _textoFecha: textoFecha
  };
})(typeof window !== 'undefined' ? window : globalThis);
