import { ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

/** Confirmación explícita de asistencia — nunca automática: el propio usuario elige por cuál(es) propiedad(es) está presente (propias o delegadas). */
export class RecordAttendanceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  propertyIds!: string[];
}
