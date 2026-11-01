# ⛨ NetworkSentry AI v3

Plataforma web profesional y multisitio para el monitoreo inteligente de redes, sistemas DVR, NVR y cámaras IP, potenciada con un agente de Inteligencia Artificial para análisis de logs y autocorrección de fallas.

---

## 🚀 Descripción del Proyecto
**NetworkSentry AI** resuelve una problemática crítica en la administración de redes locales y sistemas de seguridad: el tiempo perdido en el diagnóstico manual de logs y caídas de servicio[cite: 2]. La plataforma permite a administradores, técnicos (SOC) y clientes supervisar múltiples sitios (casas, empresas, negocios) en tiempo real, visualizar flujos de cámaras, consultar grabaciones, medir el SLA (disponibilidad) y ejecutar scripts de remediación sugeridos por la IA[cite: 2].

El desarrollo está estructurado bajo una arquitectura web limpia de capas independientes (HTML5, CSS3, JavaScript Vanilla y persistencia JSON) optimizada para entornos académicos y profesionales[cite: 3].

---

## 🛠️ Tecnologías y Estructura de Capas
El proyecto cumple estrictamente con el estándar de separación de responsabilidades:
1. **`index.html`**: Estructura semántica, maquetación visual y modales interactivos.
2. **`style.css`**: Sistema de diseño avanzado con tema oscuro de ciberseguridad, variables CSS, glassmorphism y diseño completamente adaptativo (*responsive*).
3. **`app.js`**: Lógica de negocio, gestión de sesiones, seguridad (hashing didáctico de contraseñas, control de inactividad, bloqueo por intentos), motor de simulación de IA, consola de comandos interactiva y renderizado dinámico en el DOM.
4. **`data.json`**: Base de datos local inicial con entidades relacionales (usuarios, sitios, zonas, dispositivos, logs de IA, incidencias y auditoría)[cite: 3].

---

## 👥 Roles y Permisos del Sistema
El sistema cuenta con un control de acceso basado en roles (RBAC):
* **👑 Super Admin**: Control total sobre la plataforma[cite: 3], gestión de usuarios, canales de alerta (Telegram/Correo), umbrales críticos de disco e historial de auditoría global.
* **🛠️ Técnico SOC (Operador):** Acceso al monitoreo en vivo, visualización de logs de IA, ejecución de scripts de autocorrección, cambio de estado de equipos (Mantenimiento) y documentación de incidencias[cite: 2].
* **👁️ Cliente (Visualizador):** Acceso exclusivo en modo lectura a las métricas, estado de dispositivos, cámaras en vivo y grabaciones de los sitios asignados a su cuenta.

---

## ✨ Características Principales
* **Hub Multisitio:** Tarjetas dinámicas con indicadores de estado, conteo de zonas, equipos y alertas críticas.
* **Panel de Dispositivos e Inventario:** Inserción en tiempo real de nuevos equipos con validación estricta de direcciones IPv4 y rangos de disco duro (para prevención de sobrescritura en DVRs)[cite: 3].
* **Mosaico de Cámaras en Vivo:** Simulación de streams mediante canvas interactivos con indicador REC y opción de pantalla completa.
* **Historial y Reproductor de Grabaciones:** Filtros por zona y tipo de evento (*Movimiento, Continua, Alarma*) con reproductor integrado.
* **Gráficas SLA (24 Horas):** Monitoreo de disponibilidad y estabilidad horaria de los equipos frente a la meta del 99.5%.
* **Terminal IA Interactiva:** Consola SOC tipo Linux con comandos (`help`, `status`, `alerts`, `scan`, `ping`, `diag`, `fix`) y ejecución de scripts de remediación en un clic[cite: 2].
* **Módulo de Incidencias y Auditoría:** Registro de fallas técnicas y bitácora automatizada de acciones de usuario.
* **Perfil de Usuario Avanzado:** Personalización de datos, cambio de contraseña, subida de foto de perfil y banner (con validación de peso/formato) y enlaces a redes sociales.

---

## ⚙️ Instrucciones de Instalación y Ejecución

Dado que la aplicación consume dinámicamente el archivo `data.json` mediante peticiones asíncronas (`fetch`), se requiere un servidor local para evitar restricciones de seguridad del navegador (`CORS` en protocolo `file://`).

1. Clona o descarga este repositorio en tu equipo dentro de una carpeta llamada `avance-proyecto-tunombre`[cite: 3]:
   ```bash
   git clone [https://github.com/tu-usuario/avance-proyecto-tunombre.git](https://github.com/tu-usuario/avance-proyecto-tunombre.git)