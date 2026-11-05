import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { db } from '@/mocks/db';
import { renderApp } from '@/test/renderApp';

type Usuario = Awaited<ReturnType<typeof renderApp>>['usuario'];

const tabla = () => screen.findByRole('table', { name: 'Miembros' });

async function abrirAcciones(usuario: Usuario, nombre: string) {
  await usuario.click(within(await tabla()).getByRole('button', { name: `Acciones de ${nombre}` }));
}

describe('listado de miembros (F2-01)', () => {
  it('muestra solo activos con sus ministerios', async () => {
    await renderApp('/miembros', { como: 'u-secretario' });
    const t = await tabla();
    expect(within(t).getByText('José Chan May')).toBeInTheDocument();
    expect(within(t).getByText('Jóvenes, Música')).toBeInTheDocument();
    expect(within(t).queryByText('Rosa Castillo Ek')).not.toBeInTheDocument();
  });

  it('busca sin acentos y refleja el filtro en la URL', async () => {
    const { usuario } = await renderApp('/miembros', { como: 'u-secretario' });
    await tabla();
    await usuario.type(screen.getByRole('searchbox'), 'jose');
    await waitFor(async () => {
      const t = await tabla();
      expect(within(t).getByText('José Chan May')).toBeInTheDocument();
      expect(within(t).queryByText('María Pech Canul')).not.toBeInTheDocument();
    });
  });

  it('muestra estado vacío sin resultados', async () => {
    const { usuario } = await renderApp('/miembros', { como: 'u-secretario' });
    await tabla();
    await usuario.type(screen.getByRole('searchbox'), 'zzzz');
    expect(
      await screen.findByText('No hay miembros con estos filtros', {}, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  it('filtra inactivos desde la URL', async () => {
    await renderApp('/miembros?estado=inactivo', { como: 'u-secretario' });
    const t = await tabla();
    expect(within(t).getByText('Rosa Castillo Ek')).toBeInTheDocument();
    expect(within(t).queryByText('José Chan May')).not.toBeInTheDocument();
  });

  it('TESORERO solo lee: sin "Nuevo miembro" ni "Desactivar"', async () => {
    const { usuario } = await renderApp('/miembros', { como: 'u-tesorero' });
    await abrirAcciones(usuario, 'José Chan May');
    expect(await screen.findByRole('menuitem', { name: /Ver perfil/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Desactivar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Nuevo miembro/ })).not.toBeInTheDocument();
  });
});

describe('exportar (A1-F2-02)', () => {
  it('el listado ofrece "Exportar" a quien ve el reporte', async () => {
    await renderApp('/miembros', { como: 'u-secretario' });
    expect(await screen.findByRole('button', { name: /Exportar/ })).toBeInTheDocument();
  });

  it('TESORERO no ve "Exportar" (sin reportes generales)', async () => {
    await renderApp('/miembros', { como: 'u-tesorero' });
    await tabla();
    expect(screen.queryByRole('button', { name: /Exportar/ })).not.toBeInTheDocument();
  });
});

describe('clic en fila (F2-01)', () => {
  it('abre el perfil al pulsar cualquier parte de la fila', async () => {
    const { usuario } = await renderApp('/miembros', { como: 'u-secretario' });
    await usuario.click(within(await tabla()).getByText('9991234567'));
    expect(await screen.findByRole('heading', { name: 'José Chan May' })).toBeInTheDocument();
  });

  it('las acciones de la fila no abren el perfil', async () => {
    const { usuario } = await renderApp('/miembros', { como: 'u-secretario' });
    await abrirAcciones(usuario, 'Ana Pérez Uc');
    await usuario.click(await screen.findByRole('menuitem', { name: /Desactivar/ }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Desactivar miembro');
    expect(screen.queryByRole('tab', { name: 'Datos' })).not.toBeInTheDocument();
  });
});

describe('desactivar y reactivar (F2-03)', () => {
  it('desactiva con motivo opcional y actualiza el badge sin recargar', async () => {
    const { usuario } = await renderApp('/miembros?estado=todos', { como: 'u-secretario' });
    await abrirAcciones(usuario, 'Ana Pérez Uc');
    // No existe ninguna opción "Eliminar"
    expect(screen.queryByRole('menuitem', { name: /Eliminar/ })).not.toBeInTheDocument();
    await usuario.click(await screen.findByRole('menuitem', { name: /Desactivar/ }));
    const dialogo = await screen.findByRole('dialog');
    expect(dialogo).toHaveTextContent('Se conservará todo su historial');
    await usuario.type(within(dialogo).getByLabelText('Motivo'), 'Cambio de congregación');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Desactivar' }));

    await waitFor(() =>
      expect(db.miembros.find((m) => m.id === 'm-ana')).toMatchObject({
        activo: false,
        motivoBaja: 'Cambio de congregación',
      }),
    );
    const fila = within(await tabla())
      .getByText('Ana Pérez Uc')
      .closest('tr')!;
    await waitFor(() => expect(within(fila).getByText('Inactivo')).toBeInTheDocument());
  });

  it('reactiva desde el filtro de inactivos', async () => {
    const { usuario } = await renderApp('/miembros?estado=inactivo', { como: 'u-admin' });
    await abrirAcciones(usuario, 'Rosa Castillo Ek');
    await usuario.click(await screen.findByRole('menuitem', { name: /Reactivar/ }));
    await usuario.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reactivar' }),
    );
    await waitFor(() => expect(db.miembros.find((m) => m.id === 'm-rosa')?.activo).toBe(true));
  });
});

describe('formulario de miembro (F2-02)', () => {
  it('valida los campos antes de enviar', async () => {
    const { usuario } = await renderApp('/miembros/nuevo', { como: 'u-secretario' });
    await usuario.type(await screen.findByLabelText(/Teléfono/), '123');
    await usuario.type(screen.getByLabelText(/Correo/), 'no-es-correo');
    await usuario.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Escribe el nombre.')).toBeInTheDocument();
    expect(screen.getByText('Escribe los apellidos.')).toBeInTheDocument();
    expect(screen.getByText('El teléfono debe tener de 7 a 15 dígitos.')).toBeInTheDocument();
    expect(screen.getByText('Correo no válido.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Nombre/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('crea, redirige al perfil y avisa del posible duplicado', async () => {
    const { usuario } = await renderApp('/miembros/nuevo', { como: 'u-secretario' });
    await usuario.type(await screen.findByLabelText(/^Nombre/), 'jose');
    await usuario.type(screen.getByLabelText(/Apellidos/), 'Chan May');
    await usuario.type(screen.getByLabelText(/Teléfono/), '+52 999-111 2233');
    await usuario.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByRole('heading', { name: 'jose Chan May' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver el posible duplicado' })).toHaveAttribute(
      'href',
      '/miembros/m-jose',
    );
    expect(db.miembros.find((m) => m.nombre === 'jose')?.telefono).toBe('+529991112233');
  });

  it('edita y pide confirmación al salir con cambios sin guardar', async () => {
    const { usuario } = await renderApp('/miembros/m-luis/editar', { como: 'u-secretario' });
    const nombre = await screen.findByLabelText(/^Nombre/);
    expect(nombre).toHaveValue('Luis');
    await usuario.clear(nombre);
    await usuario.type(nombre, 'Luis Alberto');
    await usuario.click(screen.getByRole('link', { name: 'Cancelar' }));
    const dialogo = await screen.findByRole('dialog');
    expect(dialogo).toHaveTextContent('¿Salir sin guardar?');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));

    await usuario.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(
      await screen.findByRole('heading', { name: 'Luis Alberto Aké Novelo' }),
    ).toBeInTheDocument();
    expect(db.miembros.find((m) => m.id === 'm-luis')?.nombre).toBe('Luis Alberto');
  });
});

describe('perfil: asistencia (F2-04)', () => {
  it('muestra el historial, el % de 3 meses y el último evento', async () => {
    const { usuario } = await renderApp('/miembros/m-jose', { como: 'u-secretario' });
    await usuario.click(await screen.findByRole('tab', { name: 'Asistencia' }));
    const tabla = await screen.findByRole('table', { name: 'Historial de asistencia' });
    expect(within(tabla).getByRole('link', { name: 'Culto dominical' })).toBeInTheDocument();
    expect(within(tabla).getByText('Presente')).toBeInTheDocument();
    expect(screen.getByText('100 %')).toBeInTheDocument();
    expect(screen.getByText('1 de 1 eventos')).toBeInTheDocument();
    expect(screen.getByText('Último evento asistido')).toBeInTheDocument();
  });

  it('estado vacío sin registros', async () => {
    const { usuario } = await renderApp('/miembros/m-sofia', { como: 'u-secretario' });
    await usuario.click(await screen.findByRole('tab', { name: 'Asistencia' }));
    expect(await screen.findByText('Sin asistencia registrada')).toBeInTheDocument();
    expect(screen.getByText('Sin registros')).toBeInTheDocument();
  });

  it('TESORERO no ve la pestaña de asistencia', async () => {
    await renderApp('/miembros/m-jose', { como: 'u-tesorero' });
    expect(await screen.findByRole('tab', { name: 'Aportaciones' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Asistencia' })).not.toBeInTheDocument();
  });

  it('COORDINADOR ve el historial de sus ministerios, sin el % general', async () => {
    const { usuario } = await renderApp('/miembros/m-jose', { como: 'u-coordinador' });
    await usuario.click(await screen.findByRole('tab', { name: 'Asistencia' }));
    expect(await screen.findByText('Sin asistencia registrada')).toBeInTheDocument();
    expect(screen.queryByText('Último evento asistido')).not.toBeInTheDocument();
  });
});

describe('perfil: aportaciones (A1-F2-01)', () => {
  it('TESORERO ve las aportaciones del miembro', async () => {
    const { usuario } = await renderApp('/miembros/m-sofia', { como: 'u-tesorero' });
    await usuario.click(await screen.findByRole('tab', { name: 'Aportaciones' }));
    expect(await screen.findByText('Este miembro aún no tiene aportaciones')).toBeInTheDocument();
  });
});

describe('perfil del miembro (F2-04, F2-05)', () => {
  it('muestra datos y ministerios; SECRETARIO no ve "Aportaciones"', async () => {
    await renderApp('/miembros/m-jose', { como: 'u-secretario' });
    expect(await screen.findByRole('heading', { name: 'José Chan May' })).toBeInTheDocument();
    expect(screen.getByText('9991234567')).toBeInTheDocument();
    const actuales = screen.getByRole('list', { name: 'Ministerios actuales' });
    expect(within(actuales).getByRole('link', { name: 'Música' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Asistencia' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Aportaciones' })).not.toBeInTheDocument();
  });

  it('TESORERO (donaciones:leer) sí ve "Aportaciones"', async () => {
    await renderApp('/miembros/m-jose', { como: 'u-tesorero' });
    expect(await screen.findByRole('tab', { name: 'Aportaciones' })).toBeInTheDocument();
  });

  it('agrega a un ministerio y lo quita', async () => {
    const { usuario } = await renderApp('/miembros/m-pedro', { como: 'u-admin' });
    await usuario.click(await screen.findByRole('combobox', { name: 'Ministerio al que agregar' }));
    await usuario.click(await screen.findByRole('option', { name: 'Niños' }));
    await usuario.click(screen.getByRole('button', { name: /Agregar a ministerio/ }));
    await waitFor(() =>
      expect(
        db.vinculos.some(
          (v) => v.miembroId === 'm-pedro' && v.ministerioId === 'min-ninos' && v.activo,
        ),
      ).toBe(true),
    );

    await usuario.click(await screen.findByRole('button', { name: 'Quitar de Niños' }));
    await usuario.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Quitar' }),
    );
    await waitFor(() =>
      expect(
        db.vinculos.find((v) => v.miembroId === 'm-pedro' && v.ministerioId === 'min-ninos')
          ?.activo,
      ).toBe(false),
    );
  });

  it('COORDINADOR solo ve como opción sus ministerios', async () => {
    const { usuario } = await renderApp('/miembros/m-pedro', { como: 'u-coordinador' });
    await usuario.click(await screen.findByRole('combobox', { name: 'Ministerio al que agregar' }));
    const opciones = await screen.findAllByRole('option');
    expect(opciones.map((o) => o.textContent)).toEqual(['Jóvenes']);
  });
});
