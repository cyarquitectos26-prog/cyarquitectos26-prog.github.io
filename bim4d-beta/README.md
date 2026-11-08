# Visor BIM 4D · Oficinas Las Bambas · Piso 18

Visor web para revisar el modelo federado del piso 18 contra el cronograma de obra y recorrerlo en realidad aumentada.

## Origen de los datos

| Dato | Fuente |
|---|---|
| Geometría y propiedades | ARQ, IISS y DATA: RVT de `02_RVT_Parametrizados_v2` (Revit 2026), exportados con `export_rvt.cs` sobre copias temporales. IIEE, IIMM y ACI: `06_IFC_Federado/DRRP_Las_Bambas_Piso_18_Federado.ifc` (IFC4 del mismo modelo v2, coordenadas idénticas a Revit) |
| Cronograma | `DimActividadProject.csv` (XML de MS Project del 04/09/2026, 385 tareas) |
| Vínculos 4D | `BridgeElementoActividad_4D_v6.csv` (13 737 vínculos) y `Condicion4D.csv` |

Exclusiones en la exportación: instancias DWG importadas, geometría de la subcategoría «Light Source» de las luminarias, líneas de modelo y textos.

## Cómo se asigna la fecha a cada elemento

1. **Puente 4D v6**: el elemento está en `DimElemento` y tiene vínculos en el puente.
2. **Anfitrión**: paneles y montantes de las mamparas heredan las actividades de su muro cortina, que está en el puente pero no tiene geometría propia.
3. **Conexión MEP**: codos, tees y accesorios que no están en el puente heredan las actividades del tramo al que están conectados en Revit.
4. **Regla del visor (propuesta)**: elementos sin vínculo en el puente (luminarias, rollers, termostatos, cajas y dispositivos de comunicaciones, barandas, etc.) reciben las tareas del cronograma que corresponden a su partida. Se muestran como propuestas pendientes de validar.
5. **Existente / no se programa**: losa del piso 19, columnas y elementos marcados como existentes en `Condicion4D`.

Los elementos que solo tienen actividades de prueba o acabado (por ejemplo el enchape de puertas existentes) toman esas fechas como su ejecución. Ningún elemento a programar queda sin fecha.

El estado al corte usa la misma lógica que el tablero Power BI v6: instalado, en instalación, suministro/fabricación, pendiente y existente.

El panel «Calidad del vínculo 4D» lista los elementos del puente que no se dibujan: los modelados fuera de la cota del piso 18 y los que ya no están en los modelos v2.

## Archivos

- `index.html`, `app.css`, `app.js`: visor (three.js 0.179).
- `ar.js`: realidad aumentada (WebXR con GPS y brújula en Android; AR Quick Look en iPhone/iPad).
- `geo.js`: georreferencia y editor en mapa satelital (Leaflet + imágenes Esri).
- `data/project.json`, `data/schedule.json`, `data/18/*.json|bin`: modelo por especialidad (posiciones cuantizadas a 16 bits, < 2 mm; vértices reordenados por elemento, diferencias zigzag e índices locales en planos de bytes y gzip: unos 7 MB para las seis especialidades).
