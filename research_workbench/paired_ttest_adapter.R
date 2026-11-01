options(warn=1,digits=17)
p <- read.delim("ttest-options.tsv",colClasses="character",check.names=FALSE)
d <- read.delim("input.tsv",colClasses=c("character","numeric","numeric"),check.names=FALSE,
    na.strings=character(),fileEncoding="UTF-8",comment.char="")
stopifnot(p$alternative %in% c("two_sided","greater","less"),!anyNA(d),!anyDuplicated(d$unit_id))
alternative <- if(p$alternative=="two_sided") "two.sided" else p$alternative
r <- stats::t.test(d$first,d$second,paired=TRUE,alternative=alternative,
    conf.level=as.numeric(p$confidence))
result <- data.frame(statistic=unname(r$statistic),df=unname(r$parameter),p_value=r$p.value,
    difference=unname(r$estimate),standard_error=r$stderr,
    ci_lower=r$conf.int[1],ci_upper=r$conf.int[2],stats_version=as.character(packageVersion("stats")),
    r_version=R.version.string,check.names=FALSE)
write.table(result,"r-stats-result.tsv",sep="\t",quote=TRUE,row.names=FALSE,
    fileEncoding="UTF-8",eol="\n",na="NA")
cat("Completed paired t-test via R stats::t.test; first minus second.\n")
