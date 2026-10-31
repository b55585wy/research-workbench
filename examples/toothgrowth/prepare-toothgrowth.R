args <- commandArgs(trailingOnly=TRUE)
out <- args[[1]]
data(ToothGrowth, package="datasets")
original <- ToothGrowth
original$source_row <- seq_len(nrow(original))
stopifnot(nrow(original)==60L)
write.csv(original, file.path(out,"toothgrowth-all60.csv"),row.names=FALSE,na="")
selected <- original[original$dose==0.5,]
selected <- selected[order(factor(selected$supp,levels=c("OJ","VC"))),]
stopifnot(nrow(selected)==20L, all(table(selected$supp)==10L))
write.csv(selected,file.path(out,"toothgrowth-dose0.5-20.csv"),row.names=FALSE,na="")
x <- selected$len[selected$supp=="OJ"]
y <- selected$len[selected$supp=="VC"]
test <- t.test(x,y,paired=FALSE,var.equal=FALSE,alternative="two.sided",conf.level=0.95)
reference <- data.frame(statistic=unname(test$statistic),df=unname(test$parameter),
  p_value=test$p.value,difference=mean(x)-mean(y),standard_error=unname(test$stderr),
  ci_lower=test$conf.int[[1]],ci_upper=test$conf.int[[2]],mean_oj=mean(x),mean_vc=mean(y),
  sd_oj=sd(x),sd_vc=sd(y),n_oj=length(x),n_vc=length(y))
write.table(reference,file.path(out,"r-reference.tsv"),sep="\t",quote=FALSE,row.names=FALSE)
writeLines(c(R.version.string,paste("datasets",as.character(packageVersion("datasets"))),
  paste("stats",as.character(packageVersion("stats")))),file.path(out,"r-environment.txt"))
helpfile <- utils:::.getHelpFile(help("ToothGrowth",package="datasets"))
writeLines(capture.output(tools::Rd2txt(helpfile)),file.path(out,"installed-ToothGrowth-help.txt"))
