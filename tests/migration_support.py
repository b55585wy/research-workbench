"""Only the explicitly optional paper fields change nullability in schema13."""
def table_info(db,table):
    optional={'documents':{'original_filename','page_count','byte_size','sha256'},'notes':{'page'}}
    result=[]
    for row in db.execute(f'PRAGMA table_info({table})'):
        row=list(row)
        if row[1] in optional.get(table,set()):row[3]=0
        result.append(tuple(row))
    return result
