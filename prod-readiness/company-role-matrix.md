# Matriz autorizada de roles por empresa

Esta matriz es el contrato funcional. No es un seed y no autoriza cambios en
PROD. Las identidades sin correo confirmado se resuelven en el panel por perfil
antes del corte; nunca se adivinan cuentas por nombre.

| Persona | Cuenta confirmada | Operadora | Soporte Fersana |
|---|---|---|---|
| Yanin | `ynavarrete@soportef.com` | Finanzas | Operador |
| Alfredo | `afajardo@soportef.com` | Finanzas | Operador |
| Denise | Pendiente de correo exacto | Finanzas | Finanzas |
| Gerardo | Pendiente de correo exacto | — | Finanzas |
| Cesar | `cesar@quantta.mx` | Director | Director |
| Lis | `lisette@dezdez.earth` | Director | Director |
| Ara | Pendiente de correo exacto | — | Operador |
| Yulma | `ychavez@fluxfinanciera.com` | — | Operador |
| Carlos | `carlos@quantta.mx` | Poder total | Poder total |
| Ramón | `ramon@quantta.mx` | Poder total | Poder total |

Reglas:

- `Poder total` se conserva como rol global SysAdmin y sólo corresponde a las
  dos cuentas confirmadas de Carlos y Ramón.
- Operador, Finanzas y Director se guardan en la membresía de la empresa.
- Cambiar de empresa debe recalcular el rol efectivo inmediatamente.
- No aplicar la matriz mientras `paso1c-company-role-cutover-preflight.sql`
  reporte policies o funciones heredadas con roles de negocio globales.
