# Public R datasets::sleep, reshaped by exact ID; software validation only.
args <- commandArgs(trailingOnly=TRUE)
stopifnot(length(args)==1L,!dir.exists(args[1]))
dir.create(args[1],recursive=TRUE)
d <- datasets::sleep
stopifnot(nrow(d)==20L,!anyDuplicated(paste(d$ID,d$group,sep=":")))
ids <- unique(as.character(d$ID))
first <- match(paste(ids,"1",sep=":"),paste(d$ID,d$group,sep=":"))
second <- match(paste(ids,"2",sep=":"),paste(d$ID,d$group,sep=":"))
stopifnot(!anyNA(first),!anyNA(second),length(ids)==10L)
wide <- data.frame(ID=ids,drug1=d$extra[first],drug2=d$extra[second],
    source_row_first=first,source_row_second=second,check.names=FALSE)
write.csv(d,file.path(args[1],"sleep-original.csv"),row.names=FALSE,fileEncoding="UTF-8",na="")
write.csv(wide,file.path(args[1],"sleep-wide.csv"),row.names=FALSE,fileEncoding="UTF-8",na="")
writeLines(capture.output(sessionInfo()),file.path(args[1],"R-session.txt"))
