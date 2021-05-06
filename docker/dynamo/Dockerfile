FROM openjdk:8-jre

RUN cd /usr/lib && \
    curl -L https://s3-us-west-2.amazonaws.com/dynamodb-local/dynamodb_local_latest.tar.gz | tar xz
RUN mkdir -p /var/lib/dynamodb

RUN apt-get update && \
    apt-get install -y supervisor awscli && \
    apt-get clean && \
    rm -fr /var/lib/apt/lists/* /tmp/* /var/tmp/*

COPY supervisord.conf /etc/supervisord.conf
RUN mkdir -p /var/log/supervisord

# dynamodb on 8000
EXPOSE 8000

# Build tables here

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
