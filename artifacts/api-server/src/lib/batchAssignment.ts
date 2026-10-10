export async function autoEnrollApprovedStudentsForClass(_cls: { id: number; subject: string | null; status: string }): Promise<number> {
  return 0;
}

export async function autoEnrollStudentIntoMatchingClasses(_student: { id: number; role?: string; status?: string; subject?: string | null }): Promise<number> {
  return 0;
}
