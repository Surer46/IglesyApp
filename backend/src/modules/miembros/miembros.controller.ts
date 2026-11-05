import type { RequestHandler } from 'express';
import { ok, okLista } from '../../lib/respuesta';
import { usuarioDe } from '../../middlewares/auth';
import type { QueryMiembros } from './miembros.schemas';
import * as miembrosService from './miembros.service';

type ConId = { id: string };

export const listar: RequestHandler = async (req, res) => {
  const { datos, meta } = await miembrosService.listar(req.query as unknown as QueryMiembros);
  res.json(okLista(datos, meta));
};

export const obtener: RequestHandler<ConId> = async (req, res) => {
  res.json(ok(await miembrosService.obtener(req.params.id, usuarioDe(req).rol)));
};

// Posible duplicado = advertencia en meta, no error (B2-01)
export const crear: RequestHandler = async (req, res) => {
  const { miembro, duplicadoId } = await miembrosService.crear(req.body);
  res
    .status(201)
    .json(
      duplicadoId ? { ...ok(miembro), meta: { posibleDuplicado: true, duplicadoId } } : ok(miembro),
    );
};

export const editar: RequestHandler<ConId> = async (req, res) => {
  res.json(ok(await miembrosService.editar(req.params.id, req.body)));
};

export const cambiarEstado: RequestHandler<ConId> = async (req, res) => {
  res.json(ok(await miembrosService.cambiarEstado(req.params.id, req.body)));
};
