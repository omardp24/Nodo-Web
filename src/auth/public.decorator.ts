import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marca una ruta o controlador como accesible sin token de Supabase.
 * Usado por SupabaseAuthGuard, que de otro modo protege todo por defecto.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
